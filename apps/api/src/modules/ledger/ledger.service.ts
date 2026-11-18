import { Inject, Injectable, Logger } from '@nestjs/common';
import { ledgerEntries, wallets, type Db, type DbOrTx, type LedgerType } from '@gunraid/db';
import { assertGemAmount } from '@gunraid/shared';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { isUniqueViolation } from '../../common/pg-errors.js';

export interface LedgerPostInput {
  userId: string;
  type: LedgerType;
  /** Сумма в гемах со знаком: + начисление, − списание. */
  amount: number;
  refType: string;
  refId?: string | null;
  /** Уникальный ключ операции (защита от двойного проведения). */
  idempotencyKey: string;
  actorId?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
}

export interface LedgerPostResult {
  entryId: number;
  balanceAfter: number;
}

export interface ReconciliationMismatch {
  userId: string;
  balance: number;
  ledgerSum: number;
  lastBalanceAfter: number | null;
}

/**
 * Единственное место, где меняется баланс. Каждое изменение — запись в ledger_entries
 * и обновление wallets.balance в одной транзакции под блокировкой строки кошелька.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Блокирует кошелёк до конца транзакции. Вызывать первым (порядок блокировок: кошелёк → предметы → прочее). */
  async lockWallet(tx: DbOrTx, userId: string): Promise<number> {
    const [row] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for('update');
    if (!row) throw new AppError('NOT_FOUND', 404, { entity: 'wallet' });
    return row.balance;
  }

  async post(tx: DbOrTx, input: LedgerPostInput): Promise<LedgerPostResult> {
    assertGemAmount(input.amount, 'ledger amount');
    if (input.amount === 0) throw new Error('ledger amount must not be zero');
    const balance = await this.lockWallet(tx, input.userId);
    const balanceAfter = balance + input.amount;
    if (balanceAfter < 0) {
      throw new AppError('INSUFFICIENT_BALANCE', 402, { balance, required: -input.amount });
    }
    let entryId: number;
    try {
      const [entry] = await tx
        .insert(ledgerEntries)
        .values({
          userId: input.userId,
          type: input.type,
          amount: input.amount,
          balanceAfter,
          refType: input.refType,
          refId: input.refId ?? null,
          idempotencyKey: input.idempotencyKey,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
          meta: input.meta ?? {},
        })
        .returning({ id: ledgerEntries.id });
      if (!entry) throw new Error('ledger insert failed');
      entryId = entry.id;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('CONFLICT', 409, { reason: 'duplicate_ledger_entry' });
      throw err;
    }
    await tx
      .update(wallets)
      .set({ balance: balanceAfter, lastEntryId: entryId, updatedAt: sql`now()` })
      .where(eq(wallets.userId, input.userId));
    return { entryId, balanceAfter };
  }

  async balanceOf(userId: string, tx: DbOrTx = this.db): Promise<number> {
    const [row] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    return row?.balance ?? 0;
  }

  /** Сверка: баланс кошелька = сумма записей = balance_after последней записи. */
  async reconcile(limit = 100): Promise<ReconciliationMismatch[]> {
    const result = await this.db.execute(sql`
      select w.user_id as "userId",
             w.balance as "balance",
             coalesce(s.total, 0)::bigint as "ledgerSum",
             le.balance_after as "lastBalanceAfter"
      from wallets w
      left join (select user_id, sum(amount)::bigint as total from ledger_entries group by user_id) s
        on s.user_id = w.user_id
      left join ledger_entries le on le.id = w.last_entry_id
      where w.balance <> coalesce(s.total, 0)
         or (w.last_entry_id is not null and le.balance_after <> w.balance)
      limit ${limit}
    `);
    const rows = result.rows as unknown as ReconciliationMismatch[];
    if (rows.length) this.logger.error(`ledger reconciliation: ${rows.length} mismatches`);
    return rows;
  }
}
