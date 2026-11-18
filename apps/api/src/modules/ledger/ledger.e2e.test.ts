import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ledgerEntries } from '@gunraid/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app.js';
import { db, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { LedgerService } from './ledger.service.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('ledger (integration)', () => {
  it('never lets the balance go negative under concurrent debits', async () => {
    const { me } = await newPlayer(app, 'conc');
    await grantGems(app, me.id, 1000);
    const ledger = app.get(LedgerService);
    // 30 параллельных списаний по 100 при балансе 1000 → ровно 10 успешных.
    const attempts = Array.from({ length: 30 }, (_, i) =>
      db(app)
        .transaction((tx) =>
          ledger.post(tx, {
            userId: me.id,
            type: 'case_open',
            amount: -100,
            refType: 'test',
            idempotencyKey: `conc:${me.id}:${i}`,
          }),
        )
        .then(
          () => 'ok' as const,
          (err: { code?: string }) => err.code ?? 'error',
        ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'ok')).toHaveLength(10);
    expect(results.filter((r) => r === 'INSUFFICIENT_BALANCE')).toHaveLength(20);
    expect(await userBalance(app, me.id)).toBe(0);
    expect(await ledger.reconcile()).toEqual([]);
  });

  it('rejects a duplicate idempotency key on the ledger level', async () => {
    const { me } = await newPlayer(app, 'dup');
    const ledger = app.get(LedgerService);
    const post = () =>
      db(app).transaction((tx) =>
        ledger.post(tx, { userId: me.id, type: 'daily_bonus', amount: 10, refType: 'test', idempotencyKey: `dup:${me.id}` }),
      );
    await post();
    await expect(post()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await userBalance(app, me.id)).toBe(10);
  });

  it('is append-only at the database level', async () => {
    const { me } = await newPlayer(app, 'imm');
    await grantGems(app, me.id, 50);
    await expect(
      db(app).execute(sql`update ledger_entries set amount = 999999 where user_id = ${me.id}`),
    ).rejects.toThrow();
    await expect(db(app).delete(ledgerEntries).where(eq(ledgerEntries.userId, me.id))).rejects.toThrow();
    expect(await userBalance(app, me.id)).toBe(50);
  });

  it('requires a reason for manual adjustments', async () => {
    const { me } = await newPlayer(app, 'rsn');
    const ledger = app.get(LedgerService);
    await expect(
      db(app).transaction((tx) =>
        ledger.post(tx, { userId: me.id, type: 'admin_adjustment', amount: 5, refType: 'test', idempotencyKey: `rsn:${me.id}` }),
      ),
    ).rejects.toThrow();
  });
});
