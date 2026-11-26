import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { adminAuditLog, cases, games, items } from '@gunraid/db';
import { ODDS_TOTAL } from '@gunraid/game-core';
import type {
  AdminCaseDetailDto,
  AdminDashboardDto,
  AdminPageDto,
  AdminSettingsDto,
  AdminUserDetailDto,
  AdminUserRowDto,
  CaseOpenResultDto,
  UpgradeConfigDto,
} from '@gunraid/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TestClient } from '../../test/app.js';
import { db, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { LedgerService } from '../ledger/ledger.service.js';

let app: NestFastifyApplication;
let admin: TestClient;
let support: TestClient;
type Err = { error: { code: string } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
  admin = new TestClient(app);
  await admin.devLogin('admin');
  support = new TestClient(app);
  await support.devLogin('support');
});
afterAll(async () => {
  await app.close();
});

describe('admin: users and balance (integration)', () => {
  it('adjusts the balance only through the ledger with a reason, once per key', async () => {
    const { me } = await newPlayer(app, 'adm');
    const noReason = await admin.post<Err>(
      `/api/v1/admin/users/${me.id}/balance`,
      { amount: 100, reason: '' },
      IK(),
    );
    expect(noReason.status).toBe(400);
    const key = IK();
    const [a, b] = await Promise.all([
      admin.post<{ balance: number }>(
        `/api/v1/admin/users/${me.id}/balance`,
        { amount: 250, reason: 'Компенсация сбоя' },
        key,
      ),
      admin.post<{ balance: number }>(
        `/api/v1/admin/users/${me.id}/balance`,
        { amount: 250, reason: 'Компенсация сбоя' },
        key,
      ),
    ]);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(await userBalance(app, me.id)).toBe(250);
    const minus = await admin.post<{ balance: number }>(
      `/api/v1/admin/users/${me.id}/balance`,
      { amount: -50, reason: 'Ошибочное начисление' },
      IK(),
    );
    expect(minus.body.balance).toBe(200);
    const tooMuch = await admin.post<Err>(
      `/api/v1/admin/users/${me.id}/balance`,
      { amount: -1000, reason: 'Списание больше баланса' },
      IK(),
    );
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_BALANCE');
    const mismatches = await app.get(LedgerService).reconcile(10_000);
    expect(mismatches.find((m) => m.userId === me.id)).toBeUndefined();
    const audit = await db(app)
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.entityId, me.id), eq(adminAuditLog.action, 'balance.adjust')));
    expect(audit).toHaveLength(2);
    expect(audit.every((x) => x.reason && x.actorId)).toBe(true);
  });

  it('support can view users but not change balances; bans lock the user out', async () => {
    const p = await newPlayer(app, 'admb');
    await grantGems(app, p.me.id, 100);
    const list = await support.get<AdminPageDto<AdminUserRowDto>>(
      `/api/v1/admin/users?q=${p.me.nickname}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.items[0]?.id).toBe(p.me.id);
    const detail = await support.get<AdminUserDetailDto>(`/api/v1/admin/users/${p.me.id}`);
    expect(detail.body.stats.ledgerSum).toBe(100);
    const forbidden = await support.post<Err>(
      `/api/v1/admin/users/${p.me.id}/balance`,
      { amount: 10, reason: 'Попытка поддержки' },
      IK(),
    );
    expect(forbidden.status).toBe(403);
    expect((await support.get('/api/v1/admin/settings')).status).toBe(403);
    expect((await p.client.get('/api/v1/admin/users')).status).toBe(403);

    const ban = await admin.post<AdminUserDetailDto>(`/api/v1/admin/users/${p.me.id}/ban`, {
      reason: 'Мультиаккаунт',
    });
    expect(ban.body.status).toBe('banned');
    const me = await p.client.get<Err>('/api/v1/me');
    expect([401, 403]).toContain(me.status);
    await admin.post(`/api/v1/admin/users/${p.me.id}/unban`);
    const flagged = await admin.patch<AdminUserDetailDto>(`/api/v1/admin/users/${p.me.id}`, {
      isSuspicious: true,
      suspiciousNote: 'Общее устройство',
    });
    expect(flagged.body.isSuspicious).toBe(true);
  });
});

describe('admin: settings, cases, dashboard (integration)', () => {
  it('validates and applies settings without code changes', async () => {
    const all = (await admin.get<AdminSettingsDto>('/api/v1/admin/settings')).body;
    const upgrade = all.values.upgrade;
    const bad = await admin.put<Err>('/api/v1/admin/settings/upgrade', {
      ...upgrade,
      commission: 5,
    });
    expect(bad.status).toBe(400);
    const ok = await admin.put('/api/v1/admin/settings/upgrade', { ...upgrade, commission: 0.12 });
    expect(ok.status).toBe(200);
    const cfg = (
      await new TestClient(app).get<UpgradeConfigDto>('/api/v1/games/cs2/upgrade/config')
    ).body;
    expect(cfg.commission).toBe(0.12);
    await admin.put('/api/v1/admin/settings/upgrade', upgrade);
  });

  it('edits case contents into a new revision with 100 % odds', async () => {
    const [c] = await db(app)
      .select({ id: cases.id, slug: cases.slug, gameId: cases.gameId })
      .from(cases)
      .innerJoin(games, eq(games.id, cases.gameId))
      .where(and(eq(games.code, 'cs2'), eq(cases.kind, 'paid')))
      .orderBy(asc(cases.price))
      .limit(1);
    const before = (await admin.get<AdminCaseDetailDto>(`/api/v1/admin/cases/${c!.id}`)).body;
    const pool = await db(app)
      .select({ id: items.id })
      .from(items)
      .where(eq(items.gameId, c!.gameId))
      .orderBy(asc(items.price))
      .limit(3);
    const bad = await admin.put<Err>(`/api/v1/admin/cases/${c!.id}/contents`, {
      contents: pool.map((p) => ({ itemId: p.id, odds: 1000 })),
    });
    expect(bad.status).toBe(400);
    const odds = [ODDS_TOTAL - 2_000_000, 1_500_000, 500_000];
    const ok = await admin.put<AdminCaseDetailDto>(`/api/v1/admin/cases/${c!.id}/contents`, {
      contents: pool.map((p, i) => ({ itemId: p.id, odds: odds[i]! })),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.revision?.version).toBe((before.revision?.version ?? 0) + 1);
    expect(ok.body.contents).toHaveLength(3);
    // Открытие идёт по новому составу
    const { client, me } = await newPlayer(app, 'admc');
    await grantGems(app, me.id, 10_000);
    const opened = await client.post<CaseOpenResultDto>(
      `/api/v1/games/cs2/cases/${c!.slug}/open`,
      { count: 3 },
      IK(),
    );
    expect(opened.status).toBe(200);
    for (const r of opened.body.results) expect(pool.map((p) => p.id)).toContain(r.item.id);
    // Возвращаем исходный состав
    await admin.put(`/api/v1/admin/cases/${c!.id}/contents`, {
      contents: before.contents.map((x) => ({ itemId: x.item.id, odds: x.odds })),
    });
  });

  it('dashboard returns GGR and RTP by mode', async () => {
    const d = await admin.get<AdminDashboardDto>('/api/v1/admin/dashboard?days=30');
    expect(d.status).toBe(200);
    expect(d.body.modes.map((m) => m.mode)).toEqual([
      'cases',
      'upgrade',
      'contract',
      'battles',
      'cargo',
    ]);
    expect(d.body.users.total).toBeGreaterThan(0);
    const cs = d.body.modes.find((m) => m.mode === 'cases')!;
    expect(cs.wagered).toBeGreaterThan(0);
    expect(cs.ggr).toBe(cs.wagered - cs.paid);
  });
});
