import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_SETTINGS,
  type DepositDto,
  type DepositQuoteDto,
  type MeDto,
  type PaymentMethodsDto,
} from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';
import { newPlayer, userBalance } from '../../test/fixtures.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider } from './providers.js';

let app: NestFastifyApplication;
type Err = { error: { code: string; details?: unknown } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

async function deposit(client: TestClient, currency: string, amount: string, method = 'card') {
  const quote = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
    method,
    currency,
    amount,
  });
  expect(quote.status).toBe(200);
  const dep = await client.post<DepositDto>(
    '/api/v1/deposits',
    { quoteId: quote.body.quoteId },
    IK(),
  );
  expect(dep.status).toBe(201);
  return { quote: quote.body, deposit: dep.body };
}

describe('payments (integration)', () => {
  it('lists test payment methods with the gem rate', async () => {
    const { client } = await newPlayer(app, 'pm');
    const res = await client.get<PaymentMethodsDto>('/api/v1/payments/methods');
    expect(res.body.gemsPerUsd).toBe(100);
    const card = res.body.methods.find((m) => m.code === 'card');
    expect(card?.isTest).toBe(true);
    expect(card?.currencies.map((c) => c.code)).toEqual(['USD', 'RUB', 'UAH']);
  });

  it('quotes gems before payment, in any currency, rounding down', async () => {
    const { client } = await newPlayer(app, 'q');
    const usd = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: '12.34',
    });
    expect(usd.body.gems).toBe(1234);
    const rub = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'RUB',
      amount: '1000',
    });
    // 1000 ₽ × 0.0125 $ × 100 = 1250 гемов
    expect(rub.body.gems).toBe(1250);
    expect(rub.body.bonusSource).toBe('first_deposit');
    const { percent, maxBonusGems } = DEFAULT_SETTINGS.firstDeposit;
    expect(rub.body.bonusGems).toBe(Math.min(Math.floor(1250 * percent), maxBonusGems));
    const low = await client.post<Err>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: '0.5',
    });
    expect(low.body.error.code).toBe('DEPOSIT_AMOUNT_TOO_LOW');
    const wrong = await client.post<Err>('/api/v1/deposits/quote', {
      method: 'crypto',
      currency: 'RUB',
      amount: '1000',
    });
    expect(wrong.body.error.code).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('credits gems + first deposit bonus exactly once', async () => {
    const { client, me } = await newPlayer(app, 'dep');
    const { percent, maxBonusGems } = DEFAULT_SETTINGS.firstDeposit;
    const first = 1000 + Math.min(Math.floor(1000 * percent), maxBonusGems);
    const { deposit: d1 } = await deposit(client, 'USD', '10');
    expect(d1.status).toBe('pending');
    expect(d1.paymentUrl).toBe(`/pay/mock/${d1.id}`);
    const done = await client.post<DepositDto>(`/api/v1/payments/mock/${d1.id}/complete`, {
      result: 'success',
    });
    expect(done.body.status).toBe('succeeded');
    expect(await userBalance(app, me.id)).toBe(first);

    // Повторный вебхук того же события не начисляет второй раз.
    const mock = app.get(MockPaymentProvider);
    const { raw, signature } = mock.buildWebhook(`mock_${d1.id}`, 'succeeded', `mock_evt_${d1.id}`);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/mock',
      payload: raw,
      headers: { 'content-type': 'application/json', [MOCK_SIGNATURE_HEADER]: signature },
    });
    expect(dup.statusCode).toBe(200);
    expect(JSON.parse(dup.body).duplicate).toBe(true);
    expect(await userBalance(app, me.id)).toBe(first);

    // Второе пополнение — без бонуса за первое.
    const { quote: q2, deposit: d2 } = await deposit(client, 'USDT', '5', 'crypto');
    expect(q2.bonusGems).toBe(0);
    await client.post(`/api/v1/payments/mock/${d2.id}/complete`, { result: 'success' });
    expect(await userBalance(app, me.id)).toBe(first + 500);
    const meRes = await client.get<MeDto>('/api/v1/me');
    expect(meRes.body.balance).toBe(first + 500);
    expect(await app.get(LedgerService).reconcile()).toEqual([]);
  });

  it('rejects webhooks with a bad signature and ignores failed payments', async () => {
    const { client, me } = await newPlayer(app, 'bad');
    const { deposit: d } = await deposit(client, 'USD', '5');
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/mock',
      payload: JSON.stringify({ eventId: 'x1', paymentId: `mock_${d.id}`, status: 'succeeded' }),
      headers: { 'content-type': 'application/json', [MOCK_SIGNATURE_HEADER]: 'f'.repeat(64) },
    });
    expect(forged.statusCode).toBe(401);
    expect(await userBalance(app, me.id)).toBe(0);

    const failed = await client.post<DepositDto>(`/api/v1/payments/mock/${d.id}/complete`, {
      result: 'fail',
    });
    expect(failed.body.status).toBe('failed');
    const again = await client.post<Err>(`/api/v1/payments/mock/${d.id}/complete`, {
      result: 'success',
    });
    expect(again.body.error.code).toBe('DEPOSIT_ALREADY_FINAL');
    expect(await userBalance(app, me.id)).toBe(0);
  });

  it('uses a quote only once and only by its owner', async () => {
    const a = await newPlayer(app, 'qa');
    const b = await newPlayer(app, 'qb');
    const quote = await a.client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: '3',
    });
    const stolen = await b.client.post<Err>(
      '/api/v1/deposits',
      { quoteId: quote.body.quoteId },
      IK(),
    );
    expect(stolen.body.error.code).toBe('QUOTE_NOT_FOUND');
    const ok = await a.client.post<DepositDto>(
      '/api/v1/deposits',
      { quoteId: quote.body.quoteId },
      IK(),
    );
    expect(ok.status).toBe(201);
    const twice = await a.client.post<Err>(
      '/api/v1/deposits',
      { quoteId: quote.body.quoteId },
      IK(),
    );
    expect(twice.body.error.code).toBe('QUOTE_NOT_FOUND');
  });
});
