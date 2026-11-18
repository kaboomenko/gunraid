import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { items, userItems } from '@gunraid/db';
import {
  CHANCE_SCALE,
  contractMultiplier,
  rollFloat,
  rollToScaled,
} from '@gunraid/game-core';
import type {
  ContractProofDto,
  ContractResultDto,
  InventoryPageDto,
  UpgradeProofDto,
  UpgradeResultDto,
} from '@gunraid/shared';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/app.js';
import { db, gameId, grantGems, grantItems, newPlayer, userBalance } from '../../test/fixtures.js';

let app: NestFastifyApplication;
type Err = { error: { code: string } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

async function itemAbove(game: string, price: number) {
  const gid = await gameId(app, game);
  const [row] = await db(app)
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(eq(items.gameId, gid), gt(items.price, price), eq(items.isActive, true)))
    .orderBy(asc(items.price))
    .limit(1);
  if (!row) throw new Error('no item');
  return row;
}

describe('upgrade (integration)', () => {
  it('stakes gems, computes the chance and pays the target only on a win', async () => {
    const { client, me } = await newPlayer(app, 'upg');
    await grantGems(app, me.id, 1000);
    const target = await itemAbove('cs2', 600);
    const res = await client.post<UpgradeResultDto>(
      '/api/v1/games/cs2/upgrade',
      { amount: 300, targetItemId: target.id },
      IK(),
    );
    expect(res.status).toBe(200);
    const expected = Math.floor(Math.min(0.75, (300 / target.price) * 0.9) * CHANCE_SCALE);
    expect(res.body.chance).toBe(expected);
    expect(res.body.isWin).toBe(res.body.roll < res.body.chance);
    expect(await userBalance(app, me.id)).toBe(700);
    const inv = await client.get<InventoryPageDto>('/api/v1/games/cs2/inventory');
    expect(inv.body.total).toBe(res.body.isWin ? 1 : 0);

    // Проверка по раскрытому сиду.
    await client.post('/api/v1/fair/rotate');
    const proof = (await client.get<UpgradeProofDto>(`/api/v1/fair/proof/upgrade/${res.body.id}`)).body;
    expect(rollToScaled(rollFloat(proof.serverSeed as string, proof.clientSeed, proof.nonce))).toBe(proof.roll);
  });

  it('stakes items: they are consumed whatever the result', async () => {
    const { client, me } = await newPlayer(app, 'upgi');
    const granted = await grantItems(app, me.id, 'standoff2', 2, 10);
    const stake = granted.reduce((s, g) => s + g.price, 0);
    const target = await itemAbove('standoff2', stake * 2);
    const res = await client.post<UpgradeResultDto>(
      '/api/v1/games/standoff2/upgrade',
      { userItemIds: granted.map((g) => g.userItemId), targetItemId: target.id },
      IK(),
    );
    expect(res.status).toBe(200);
    const rows = await db(app)
      .select({ status: userItems.status })
      .from(userItems)
      .where(inArray(userItems.id, granted.map((g) => g.userItemId)));
    expect(rows.every((r) => r.status === 'used_upgrade')).toBe(true);
  });

  it('rejects cheaper targets and too low chances', async () => {
    const { client, me } = await newPlayer(app, 'upgx');
    await grantGems(app, me.id, 100_000);
    const cheap = await itemAbove('cs2', 0);
    const bad = await client.post<Err>('/api/v1/games/cs2/upgrade', { amount: 5000, targetItemId: cheap.id }, IK());
    expect(bad.body.error.code).toBe('UPGRADE_TARGET_INVALID');
    const knife = await itemAbove('cs2', 100_000);
    const low = await client.post<Err>('/api/v1/games/cs2/upgrade', { amount: 1, targetItemId: knife.id }, IK());
    expect(low.body.error.code).toBe('UPGRADE_CHANCE_TOO_LOW');
    expect(await userBalance(app, me.id)).toBe(100_000);
  });

  it('uses one item in only one of two parallel operations', async () => {
    const { client, me } = await newPlayer(app, 'upgr');
    const [item] = await grantItems(app, me.id, 'cs2', 1, 15);
    const target = await itemAbove('cs2', item!.price * 3);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        client.post<UpgradeResultDto | Err>(
          '/api/v1/games/cs2/upgrade',
          { userItemIds: [item!.userItemId], targetItemId: target.id },
          IK(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('contract (integration)', () => {
  it('requires 3–10 items', async () => {
    const { client, me } = await newPlayer(app, 'ctc');
    const granted = await grantItems(app, me.id, 'cs2', 2);
    const res = await client.post<Err>('/api/v1/games/cs2/contract', { userItemIds: granted.map((g) => g.userItemId) }, IK());
    expect(res.body.error.code).toBe('CONTRACT_ITEMS_COUNT');
  });

  it('melts items into one by a verifiable multiplier', async () => {
    const { client, me } = await newPlayer(app, 'ct');
    const granted = await grantItems(app, me.id, 'cs2', 4, 8);
    const input = granted.reduce((s, g) => s + g.price, 0);
    const res = await client.post<ContractResultDto>('/api/v1/games/cs2/contract', { userItemIds: granted.map((g) => g.userItemId) }, IK());
    expect(res.status).toBe(200);
    expect(res.body.inputValue).toBe(input);
    expect(res.body.min).toBe(Math.floor(input * 0.25));
    expect(res.body.max).toBe(Math.ceil(input * 4));
    expect(res.body.multiplier).toBeGreaterThanOrEqual(0.25);
    expect(res.body.multiplier).toBeLessThan(4);
    const inv = await client.get<InventoryPageDto>('/api/v1/games/cs2/inventory');
    expect(inv.body.total).toBe(1);
    expect(inv.body.items[0]?.item.id).toBe(res.body.result.id);

    await client.post('/api/v1/fair/rotate');
    const proof = (await client.get<ContractProofDto>(`/api/v1/fair/proof/contract/${res.body.id}`)).body;
    const k = contractMultiplier(rollFloat(proof.serverSeed as string, proof.clientSeed, proof.nonce), {
      commission: 0.1,
      coefMin: proof.coefMin,
      coefMax: proof.coefMax,
    });
    expect(k).toBeCloseTo(proof.multiplier, 10);
    expect(await userBalance(app, me.id)).toBe(0);
  });

  it('does not let two parallel contracts use the same items', async () => {
    const { client, me } = await newPlayer(app, 'ctr');
    const granted = await grantItems(app, me.id, 'standoff2', 3, 5);
    const body = { userItemIds: granted.map((g) => g.userItemId) };
    const results = await Promise.all(
      Array.from({ length: 3 }, () => client.post<ContractResultDto | Err>('/api/v1/games/standoff2/contract', body, IK())),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});
