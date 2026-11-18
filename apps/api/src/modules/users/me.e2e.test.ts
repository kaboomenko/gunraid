import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeDto } from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

type Err = { error: { code: string } };

describe('/me (integration)', () => {
  it('records 18+ confirmation', async () => {
    const c = new TestClient(app);
    await c.devLogin('player', `age${Date.now()}`);
    expect((await c.get<MeDto>('/api/v1/me')).body.adultConfirmed).toBe(false);
    const res = await c.post<MeDto>('/api/v1/me/confirm-age', { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.adultConfirmed).toBe(true);
  });

  it('updates settings and the selected game', async () => {
    const c = new TestClient(app);
    await c.loginNewPlayer('set');
    const res = await c.patch<MeDto>('/api/v1/me/settings', {
      soundEnabled: false,
      fastModeDefault: true,
      selectedGame: 'cs2',
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ soundEnabled: false, fastModeDefault: true });
    expect(res.body.selectedGame).toBe('cs2');
    const bad = await c.patch<Err>('/api/v1/me/settings', { selectedGame: 'unknown-game' });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('GAME_NOT_FOUND');
  });

  it('validates the CS2 trade url and the Standoff 2 player id', async () => {
    const c = new TestClient(app);
    await c.loginNewPlayer('prof');
    const bad = await c.put<Err>('/api/v1/me/games/cs2/profile', { tradeUrl: 'https://example.com' });
    expect(bad.body.error.code).toBe('TRADE_URL_INVALID');

    const url = 'https://steamcommunity.com/tradeoffer/new/?partner=123456789&token=AbCd_123';
    const ok = await c.put<MeDto>('/api/v1/me/games/cs2/profile', { tradeUrl: url });
    expect(ok.status).toBe(200);
    expect(ok.body.gameProfiles.cs2?.tradeUrl).toBe(url);

    const badId = await c.put<Err>('/api/v1/me/games/standoff2/profile', { playerId: 'abc' });
    expect(badId.body.error.code).toBe('PLAYER_ID_INVALID');
    const okId = await c.put<MeDto>('/api/v1/me/games/standoff2/profile', { playerId: '51234567' });
    expect(okId.body.gameProfiles.standoff2?.playerId).toBe('51234567');

    const wrongField = await c.put<Err>('/api/v1/me/games/standoff2/profile', { tradeUrl: url });
    expect(wrongField.status).toBe(400);
  });

  it('does not allow unlinking the last identity', async () => {
    const c = new TestClient(app);
    await c.loginNewPlayer('last');
    const res = await c.delete<Err>('/api/v1/me/identities/dev');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_IDENTITY');
  });

  it('returns a public profile by short id', async () => {
    const c = new TestClient(app);
    const nick = await c.loginNewPlayer('pub');
    const me = await c.get<MeDto>('/api/v1/me');
    const pub = await new TestClient(app).get<{ nickname: string }>(`/api/v1/users/${me.body.shortId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.nickname).toBe(nick);
  });
});
