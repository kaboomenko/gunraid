import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InventoryPageDto, SellResultDto } from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app.js';
import { grantItems, newPlayer, userBalance } from '../../test/fixtures.js';
import { LedgerService } from '../ledger/ledger.service.js';

let app: NestFastifyApplication;
type Err = { error: { code: string } };

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

describe('inventory (integration)', () => {
  it('lists the inventory per game with total value', async () => {
    const { client, me } = await newPlayer(app, 'inv');
    const granted = await grantItems(app, me.id, 'cs2', 3);
    await grantItems(app, me.id, 'standoff2', 2);
    const res = await client.get<InventoryPageDto>('/api/v1/games/cs2/inventory?sort=price_desc');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.totalValue).toBe(granted.reduce((a, b) => a + b.price, 0));
    const prices = res.body.items.map((i) => i.item.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    const so2 = await client.get<InventoryPageDto>('/api/v1/games/standoff2/inventory');
    expect(so2.body.total).toBe(2);
  });

  it('sells selected items for gems and is idempotent', async () => {
    const { client, me } = await newPlayer(app, 'sell');
    const [a, b] = await grantItems(app, me.id, 'cs2', 2, 5);
    const headers = IK();
    const body = { userItemIds: [a!.userItemId, b!.userItemId] };
    const first = await client.post<SellResultDto>(
      '/api/v1/games/cs2/inventory/sell',
      body,
      headers,
    );
    expect(first.status).toBe(200);
    expect(first.body.soldCount).toBe(2);
    expect(first.body.total).toBe(a!.price + b!.price);
    // Повтор с тем же ключом — тот же ответ, деньги второй раз не начисляются.
    const replay = await client.post<SellResultDto>(
      '/api/v1/games/cs2/inventory/sell',
      body,
      headers,
    );
    expect(replay.body).toEqual(first.body);
    expect(await userBalance(app, me.id)).toBe(a!.price + b!.price);
    // Тот же ключ с другим телом — ошибка.
    const reused = await client.post<Err>(
      '/api/v1/games/cs2/inventory/sell',
      { all: true },
      headers,
    );
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Повторная продажа проданного — недоступно.
    const again = await client.post<Err>('/api/v1/games/cs2/inventory/sell', body, IK());
    expect(again.body.error.code).toBe('ITEM_NOT_AVAILABLE');
  });

  it('sells everything with { all: true }', async () => {
    const { client, me } = await newPlayer(app, 'all');
    const granted = await grantItems(app, me.id, 'standoff2', 4, 2);
    const res = await client.post<SellResultDto>(
      '/api/v1/games/standoff2/inventory/sell',
      { all: true },
      IK(),
    );
    expect(res.body.soldCount).toBe(4);
    expect(res.body.balance).toBe(granted.reduce((s, g) => s + g.price, 0));
    const none = await client.post<Err>(
      '/api/v1/games/standoff2/inventory/sell',
      { all: true },
      IK(),
    );
    expect(none.body.error.code).toBe('NOTHING_TO_SELL');
  });

  it('sells an item only once under concurrent requests (double click, two tabs)', async () => {
    const { client, me } = await newPlayer(app, 'race');
    const [item] = await grantItems(app, me.id, 'cs2', 1, 10);
    const body = { userItemIds: [item!.userItemId] };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        client.post<SellResultDto | Err>('/api/v1/games/cs2/inventory/sell', body, IK()),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await userBalance(app, me.id)).toBe(item!.price);
    expect(await app.get(LedgerService).reconcile()).toEqual([]);
  });

  it('cannot sell items of another user and requires an idempotency key', async () => {
    const owner = await newPlayer(app, 'own');
    const [item] = await grantItems(app, owner.me.id, 'cs2', 1);
    const thief = await newPlayer(app, 'thf');
    const res = await thief.client.post<Err>(
      '/api/v1/games/cs2/inventory/sell',
      { userItemIds: [item!.userItemId] },
      IK(),
    );
    expect(res.body.error.code).toBe('ITEM_NOT_AVAILABLE');
    const noKey = await owner.client.post<Err>('/api/v1/games/cs2/inventory/sell', {
      userItemIds: [item!.userItemId],
    });
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
