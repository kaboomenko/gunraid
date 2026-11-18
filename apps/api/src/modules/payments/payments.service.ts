import { Inject, Injectable, Logger } from '@nestjs/common';
import { deposits, newId, paymentEvents, users, type Db, type DbOrTx } from '@gunraid/db';
import {
  formatDecimal,
  parseDecimal,
  quoteGems,
  type DepositDto,
  type DepositQuoteBody,
  type DepositQuoteDto,
  type PageDto,
  type PaymentMethodsDto,
} from '@gunraid/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { rkey } from '../../core/redis.js';
import { DB, ENV, REDIS } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  FX_RATE_PROVIDER,
  MOCK_SIGNATURE_HEADER,
  MockPaymentProvider,
  PAYMENT_PROVIDERS,
  type FxRateProvider,
  type PaymentProvider,
} from './providers.js';

interface StoredQuote {
  quoteId: string;
  userId: string;
  provider: string;
  method: string;
  currency: string;
  amount: string;
  usdRate: string;
  gemsPerUsd: number;
  gems: number;
  bonusGems: number;
  bonusSource: string | null;
  expiresAt: string;
}

const USD_PRESETS = [5, 10, 25, 50, 100];

function niceRound(n: number): number {
  if (n <= 0) return 0;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

function toDto(row: typeof deposits.$inferSelect): DepositDto {
  return {
    id: row.id,
    status: row.status,
    method: row.method,
    payCurrency: row.payCurrency,
    payAmount: formatDecimal(parseDecimal(row.payAmount), 8),
    gemsAmount: row.gemsAmount,
    bonusGems: row.bonusGems,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    paymentUrl: (row.meta.paymentUrl as string | undefined) ?? null,
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
    @Inject(FX_RATE_PROVIDER) private readonly fx: FxRateProvider,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  private provider(code: string): PaymentProvider {
    const p = this.providers.find((x) => x.code === code);
    if (!p) throw new AppError('NOT_FOUND', 404, { provider: code });
    return p;
  }

  private providerForMethod(method: string): PaymentProvider {
    const p = this.providers.find((x) => x.methods().some((m) => m.code === method));
    if (!p) throw new AppError('CURRENCY_NOT_SUPPORTED', 400, { method });
    return p;
  }

  async methods(): Promise<PaymentMethodsDto> {
    const [{ gemsPerUsd }, limits, rates] = await Promise.all([
      this.settings.get('currency'),
      this.settings.get('deposit'),
      this.fx.list(),
    ]);
    const rateMap = new Map(rates.map((r) => [r.currency, r]));
    return {
      gemsPerUsd,
      minGems: limits.minGems,
      maxGems: limits.maxGems,
      methods: this.providers.flatMap((p) =>
        p.methods().map((m) => ({
          code: m.code,
          provider: p.code,
          isTest: p.isTest,
          currencies: m.currencies
            .map((c) => rateMap.get(c))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
            .map((r) => {
              const usdPerUnit = Number(r.usdRate);
              const minAmount = Math.ceil((limits.minGems / gemsPerUsd / usdPerUnit) * 100) / 100;
              return {
                code: r.currency,
                kind: r.kind,
                usdRate: r.usdRate,
                minAmount: minAmount.toFixed(2).replace(/\.00$/, ''),
                presets: USD_PRESETS.map((usd) => String(niceRound(usd / usdPerUnit))),
              };
            }),
        })),
      ),
    };
  }

  private quoteKey(id: string): string {
    return rkey(this.env, 'quote', id);
  }

  /** Котировка: сколько гемов будет начислено (и бонус) — показывается до подтверждения оплаты. */
  async quote(userId: string, body: DepositQuoteBody): Promise<DepositQuoteDto> {
    const provider = this.providerForMethod(body.method);
    const method = provider.methods().find((m) => m.code === body.method);
    if (!method?.currencies.includes(body.currency))
      throw new AppError('CURRENCY_NOT_SUPPORTED', 400);
    const rate = await this.fx.get(body.currency);
    if (!rate) throw new AppError('CURRENCY_NOT_SUPPORTED', 400);
    const [{ gemsPerUsd, quoteTtlMinutes }, limits, firstDeposit] = await Promise.all([
      this.settings.get('currency'),
      this.settings.get('deposit'),
      this.settings.get('firstDeposit'),
    ]);
    const gems = quoteGems(body.amount, rate.usdRate, gemsPerUsd);
    if (gems < limits.minGems)
      throw new AppError('DEPOSIT_AMOUNT_TOO_LOW', 400, { minGems: limits.minGems });
    if (gems > limits.maxGems)
      throw new AppError('DEPOSIT_AMOUNT_TOO_HIGH', 400, { maxGems: limits.maxGems });

    const [user] = await this.db
      .select({ firstDepositAt: users.firstDepositAt })
      .from(users)
      .where(eq(users.id, userId));
    let bonusGems = 0;
    let bonusSource: string | null = null;
    if (user && !user.firstDepositAt && firstDeposit.percent > 0) {
      bonusGems = Math.min(Math.floor(gems * firstDeposit.percent), firstDeposit.maxBonusGems);
      if (bonusGems > 0) bonusSource = 'first_deposit';
    }
    const quoteId = newId();
    const expiresAt = new Date(Date.now() + quoteTtlMinutes * 60_000).toISOString();
    const stored: StoredQuote = {
      quoteId,
      userId,
      provider: provider.code,
      method: body.method,
      currency: body.currency,
      amount: body.amount,
      usdRate: rate.usdRate,
      gemsPerUsd,
      gems,
      bonusGems,
      bonusSource,
      expiresAt,
    };
    await this.redis.set(
      this.quoteKey(quoteId),
      JSON.stringify(stored),
      'EX',
      quoteTtlMinutes * 60,
    );
    return {
      quoteId,
      method: body.method,
      currency: body.currency,
      amount: body.amount,
      usdRate: rate.usdRate,
      gemsPerUsd,
      gems,
      bonusGems,
      bonusSource,
      expiresAt,
    };
  }

  /** Создание пополнения по котировке (курс и сумма гемов фиксируются в записи). */
  async createDeposit(tx: DbOrTx, userId: string, quoteId: string): Promise<DepositDto> {
    const raw = await this.redis.get(this.quoteKey(quoteId));
    if (!raw) throw new AppError('QUOTE_NOT_FOUND', 404);
    const q = JSON.parse(raw) as StoredQuote;
    if (q.userId !== userId) throw new AppError('QUOTE_NOT_FOUND', 404);
    if (new Date(q.expiresAt).getTime() < Date.now()) throw new AppError('QUOTE_EXPIRED', 410);
    const provider = this.provider(q.provider);
    const id = newId();
    // Для тестового провайдера создание платежа не ходит в сеть. Реальным провайдерам — тот же интерфейс.
    const payment = await provider.createPayment({
      depositId: id,
      userId,
      method: q.method,
      currency: q.currency,
      amount: q.amount,
    });
    const [row] = await tx
      .insert(deposits)
      .values({
        id,
        userId,
        provider: provider.code,
        providerPaymentId: payment.providerPaymentId,
        method: q.method,
        payCurrency: q.currency,
        payAmount: q.amount,
        usdRate: q.usdRate,
        gemsPerUsd: q.gemsPerUsd,
        gemsAmount: q.gems,
        bonusGems: q.bonusGems,
        bonusSource: q.bonusSource,
        quoteExpiresAt: new Date(q.expiresAt),
        meta: { paymentUrl: payment.paymentUrl, isTest: provider.isTest },
      })
      .returning();
    if (!row) throw new Error('deposit insert failed');
    await this.redis.del(this.quoteKey(quoteId));
    return toDto(row);
  }

  async getDeposit(userId: string, id: string): Promise<DepositDto> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('DEPOSIT_NOT_FOUND', 404);
    const [row] = await this.db
      .select()
      .from(deposits)
      .where(and(eq(deposits.id, id), eq(deposits.userId, userId)))
      .limit(1);
    if (!row) throw new AppError('DEPOSIT_NOT_FOUND', 404);
    return toDto(row);
  }

  async listDeposits(
    userId: string,
    cursor: string | undefined,
    limit = 20,
  ): Promise<PageDto<DepositDto>> {
    const where = cursor
      ? and(eq(deposits.userId, userId), lt(deposits.createdAt, new Date(cursor)))
      : eq(deposits.userId, userId);
    const rows = await this.db
      .select()
      .from(deposits)
      .where(where)
      .orderBy(desc(deposits.createdAt))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map(toDto),
      nextCursor:
        rows.length > limit ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
    };
  }

  /**
   * Вебхук провайдера: проверка подписи, идемпотентность по event_id, зачисление гемов
   * (и бонуса) через ledger в одной транзакции с блокировкой депозита.
   */
  async handleWebhook(
    providerCode: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true; duplicate?: boolean }> {
    const provider = this.provider(providerCode);
    let event;
    try {
      event = provider.parseWebhook(rawBody, headers);
    } catch (err) {
      await this.db.insert(paymentEvents).values({
        id: newId(),
        provider: providerCode,
        eventId: `rejected:${newId()}`,
        payload: { raw: rawBody.slice(0, 4000) },
        signatureOk: false,
        error: err instanceof AppError ? err.code : 'parse_error',
      });
      throw err;
    }

    const eventRowId = newId();
    const inserted = await this.db
      .insert(paymentEvents)
      .values({
        id: eventRowId,
        provider: providerCode,
        eventId: event.eventId,
        payload: JSON.parse(rawBody),
        signatureOk: true,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!inserted.length) return { ok: true, duplicate: true };

    const outcome = await this.db.transaction(async (tx) => {
      const [deposit] = await tx
        .select()
        .from(deposits)
        .where(
          and(
            eq(deposits.provider, providerCode),
            eq(deposits.providerPaymentId, event.providerPaymentId),
          ),
        )
        .for('update');
      if (!deposit) throw new AppError('DEPOSIT_NOT_FOUND', 404);
      if (deposit.status !== 'pending')
        return { userId: deposit.userId, balance: null as number | null };

      if (event.status !== 'succeeded') {
        await tx
          .update(deposits)
          .set({
            status: event.status === 'cancelled' ? 'cancelled' : 'failed',
            completedAt: sql`now()`,
          })
          .where(eq(deposits.id, deposit.id));
        return { userId: deposit.userId, balance: null };
      }

      await this.ledger.lockWallet(tx, deposit.userId);
      const [user] = await tx
        .select({ firstDepositAt: users.firstDepositAt })
        .from(users)
        .where(eq(users.id, deposit.userId))
        .for('update');
      let bonus = deposit.bonusGems;
      if (deposit.bonusSource === 'first_deposit' && user?.firstDepositAt) bonus = 0;

      let res = await this.ledger.post(tx, {
        userId: deposit.userId,
        type: 'deposit',
        amount: deposit.gemsAmount,
        refType: 'deposit',
        refId: deposit.id,
        idempotencyKey: `deposit:${deposit.id}`,
        meta: { currency: deposit.payCurrency, amount: deposit.payAmount, provider: providerCode },
      });
      if (bonus > 0) {
        res = await this.ledger.post(tx, {
          userId: deposit.userId,
          type: 'deposit_bonus',
          amount: bonus,
          refType: 'deposit',
          refId: deposit.id,
          idempotencyKey: `deposit_bonus:${deposit.id}`,
          meta: { source: deposit.bonusSource },
        });
      }
      await tx
        .update(deposits)
        .set({ status: 'succeeded', completedAt: sql`now()`, bonusGems: bonus })
        .where(eq(deposits.id, deposit.id));
      await tx
        .update(users)
        .set({ firstDepositAt: sql`coalesce(${users.firstDepositAt}, now())` })
        .where(eq(users.id, deposit.userId));
      return { userId: deposit.userId, balance: res.balanceAfter };
    });

    await this.db
      .update(paymentEvents)
      .set({ processedAt: sql`now()` })
      .where(eq(paymentEvents.id, eventRowId));
    if (outcome.balance !== null) this.realtime.balance(outcome.userId, outcome.balance);
    return { ok: true };
  }

  /** ТЕСТОВАЯ оплата: формирует подписанный вебхук тестового провайдера и проводит его. */
  async mockComplete(
    userId: string,
    depositId: string,
    result: 'success' | 'fail',
  ): Promise<DepositDto> {
    const dep = await this.getDeposit(userId, depositId);
    const [row] = await this.db.select().from(deposits).where(eq(deposits.id, dep.id));
    if (!row || row.provider !== 'mock') throw new AppError('DEPOSIT_NOT_FOUND', 404);
    if (row.status !== 'pending') throw new AppError('DEPOSIT_ALREADY_FINAL', 409);
    const mock = this.provider('mock') as MockPaymentProvider;
    const { raw, signature } = mock.buildWebhook(
      row.providerPaymentId as string,
      result === 'success' ? 'succeeded' : 'failed',
      `mock_evt_${row.id}`,
    );
    await this.handleWebhook('mock', raw, { [MOCK_SIGNATURE_HEADER]: signature });
    return this.getDeposit(userId, depositId);
  }
}
