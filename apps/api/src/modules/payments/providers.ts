import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { fxRates, type Db } from '@gunraid/db';
import { asc, eq } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { DB, ENV } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';

// ---------------- Курсы валют ----------------

export interface FxRate {
  currency: string;
  kind: 'fiat' | 'crypto';
  /** Долларов за 1 единицу валюты (десятичная строка). */
  usdRate: string;
}

/**
 * Курсы валют оплаты к доллару для котировок «сколько гемов будет начислено».
 * Сейчас — из таблицы fx_rates (правятся в админке); позже — реализация от платёжного провайдера / курсового API.
 */
export interface FxRateProvider {
  list(): Promise<FxRate[]>;
  get(currency: string): Promise<FxRate | null>;
}

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

@Injectable()
export class DbFxRateProvider implements FxRateProvider {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(): Promise<FxRate[]> {
    const rows = await this.db
      .select()
      .from(fxRates)
      .where(eq(fxRates.isActive, true))
      .orderBy(asc(fxRates.sortOrder));
    return rows.map((r) => ({ currency: r.currency, kind: r.kind as FxRate['kind'], usdRate: r.usdRate }));
  }

  async get(currency: string): Promise<FxRate | null> {
    return (await this.list()).find((r) => r.currency === currency) ?? null;
  }
}

// ---------------- Платёжные провайдеры ----------------

export interface CreatePaymentInput {
  depositId: string;
  userId: string;
  method: string;
  currency: string;
  amount: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  paymentUrl: string;
}

export interface PaymentWebhookEvent {
  eventId: string;
  providerPaymentId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

/**
 * Интерфейс пополнения. Новый провайдер (карты, крипта) = новый класс + регистрация в PAYMENT_PROVIDERS;
 * PaymentsService и вызывающий код не меняются.
 */
export interface PaymentProvider {
  readonly code: string;
  /** Тестовый провайдер — явно помечается в интерфейсе. */
  readonly isTest: boolean;
  methods(): Array<{ code: string; currencies: string[] }>;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Проверяет подпись и разбирает вебхук; при неверной подписи — PAYMENT_SIGNATURE_INVALID. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

/**
 * ЗАГЛУШКА (разрешена ТЗ, раздел 12): имитирует платёж, вебхук и подпись.
 * Оплата «проводится» на странице сайта /pay/mock/<id> кнопками «успех» / «ошибка».
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock';
  readonly isTest = true;

  constructor(@Inject(ENV) private readonly env: Env) {}

  methods() {
    return [
      { code: 'card', currencies: ['USD', 'RUB', 'UAH'] },
      { code: 'crypto', currencies: ['USDT'] },
    ];
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { providerPaymentId: `mock_${input.depositId}`, paymentUrl: `/pay/mock/${input.depositId}` };
  }

  sign(rawBody: string): string {
    return createHmac('sha256', this.env.PAYMENT_MOCK_SECRET).update(rawBody).digest('hex');
  }

  /** Тело и подпись вебхука, который «прислал бы» провайдер. */
  buildWebhook(providerPaymentId: string, status: PaymentWebhookEvent['status'], eventId: string) {
    const raw = JSON.stringify({ eventId, paymentId: providerPaymentId, status });
    return { raw, signature: this.sign(raw) };
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent {
    const header = headers[MOCK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    const expected = this.sign(rawBody);
    if (
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID', 401);
    }
    let body: { eventId?: unknown; paymentId?: unknown; status?: unknown };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      throw new AppError('VALIDATION_ERROR', 400);
    }
    if (
      typeof body.eventId !== 'string' ||
      typeof body.paymentId !== 'string' ||
      !['succeeded', 'failed', 'cancelled'].includes(String(body.status))
    ) {
      throw new AppError('VALIDATION_ERROR', 400);
    }
    return {
      eventId: body.eventId,
      providerPaymentId: body.paymentId,
      status: body.status as PaymentWebhookEvent['status'],
    };
  }
}
