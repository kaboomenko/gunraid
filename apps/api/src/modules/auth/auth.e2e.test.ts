import { createHash, createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { COOKIES, type MeDto } from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('auth (integration)', () => {
  it('rejects mutating requests without CSRF token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CSRF_FAILED');
  });

  it('dev login creates a user with wallet and returns /me', async () => {
    const c = new TestClient(app);
    const nick = await c.loginNewPlayer('auth');
    const me = await c.get<MeDto>('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.nickname).toBe(nick);
    expect(me.body.balance).toBe(0);
    expect(me.body.adultConfirmed).toBe(true);
    expect(me.body.identities[0]?.provider).toBe('dev');
  });

  it('guests get 401 on /me', async () => {
    const c = new TestClient(app);
    const res = await c.get<{ error: { code: string } }>('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates refresh token and detects reuse of an old one', async () => {
    const c = new TestClient(app);
    await c.loginNewPlayer('rot');
    const firstRefresh = c.cookies.get(COOKIES.refresh);
    expect(firstRefresh).toBeTruthy();

    const r1 = await c.post('/api/v1/auth/refresh');
    expect(r1.status).toBe(200);
    const secondRefresh = c.cookies.get(COOKIES.refresh);
    expect(secondRefresh).not.toBe(firstRefresh);
    expect((await c.get('/api/v1/me')).status).toBe(200);

    // Повтор старого токена в окне гонки — 409, сессия не трогается.
    const thief = new TestClient(app);
    thief.cookies.set(COOKIES.refresh, firstRefresh as string);
    const race = await thief.post<{ error: { code: string } }>('/api/v1/auth/refresh');
    expect(race.status).toBe(409);
    expect(race.body.error.code).toBe('REFRESH_RACE');
    expect((await c.get('/api/v1/me')).status).toBe(200);
  });

  it('logout-all revokes every session immediately', async () => {
    const a = new TestClient(app);
    const nick = await a.loginNewPlayer('all');
    const b = new TestClient(app);
    await b.devLogin('player', nick);
    expect((await b.get('/api/v1/me')).status).toBe(200);

    const res = await a.post<{ revoked: number }>('/api/v1/auth/logout-all');
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(2);

    const after = await b.get<{ error: { code: string } }>('/api/v1/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    // refresh тоже не работает
    expect((await b.post('/api/v1/auth/refresh')).status).toBe(401);
  });

  it('logout clears cookies and revokes the session', async () => {
    const c = new TestClient(app);
    await c.loginNewPlayer('out');
    const access = c.cookies.get(COOKIES.access) as string;
    expect((await c.post('/api/v1/auth/logout')).status).toBe(200);
    expect(c.cookies.has(COOKIES.access)).toBe(false);
    const ghost = new TestClient(app);
    ghost.cookies.set(COOKIES.access, access);
    expect((await ghost.get('/api/v1/me')).status).toBe(401);
  });

  it('enforces roles on admin routes', async () => {
    const player = new TestClient(app);
    await player.loginNewPlayer('role');
    expect((await player.get('/api/v1/admin/ping')).status).toBe(403);

    const admin = new TestClient(app);
    await admin.devLogin('admin');
    const ok = await admin.get<{ role: string }>('/api/v1/admin/ping');
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('admin');
  });

  it('logs in with a valid Telegram widget payload and rejects a forged one', async () => {
    const fields = {
      id: 700000000 + Math.floor(Math.random() * 1_000_000),
      first_name: 'Tg',
      username: 'tg_user',
      auth_date: Math.floor(Date.now() / 1000),
    };
    const check = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secret = createHash('sha256').update('123456:TEST-TOKEN').digest();
    const hash = createHmac('sha256', secret).update(check).digest('hex');

    const c = new TestClient(app);
    const ok = await c.post<{ created: boolean }>('/api/v1/auth/telegram', { ...fields, hash });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(true);
    const me = await c.get<MeDto>('/api/v1/me');
    expect(me.body.identities[0]?.displayName).toBe('@tg_user');

    const forged = new TestClient(app);
    const bad = await forged.post<{ error: { code: string } }>('/api/v1/auth/telegram', {
      ...fields,
      hash: 'f'.repeat(64),
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('AUTH_FAILED');
  });
});
