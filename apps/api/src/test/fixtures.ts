import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { games, items, users, type Db } from '@gunraid/db';
import type { MeDto } from '@gunraid/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DB } from '../core/tokens.js';
import { InventoryService } from '../modules/inventory/inventory.service.js';
import { LedgerService } from '../modules/ledger/ledger.service.js';
import { TestClient } from './app.js';

export function db(app: NestFastifyApplication): Db {
  return app.get<Db>(DB);
}

export async function gameId(app: NestFastifyApplication, code: string): Promise<number> {
  const [g] = await db(app).select({ id: games.id }).from(games).where(eq(games.code, code));
  if (!g) throw new Error(`game ${code} missing`);
  return g.id;
}

/** Начислить гемы тестовому пользователю через ledger (как ручная корректировка с причиной). */
export async function grantGems(app: NestFastifyApplication, userId: string, amount: number): Promise<number> {
  const ledger = app.get(LedgerService);
  return db(app).transaction(async (tx) => {
    const res = await ledger.post(tx, {
      userId,
      type: 'admin_adjustment',
      amount,
      refType: 'test',
      idempotencyKey: `test:${userId}:${Date.now()}:${Math.random()}`,
      reason: 'test fixture',
    });
    return res.balanceAfter;
  });
}

/** Выдать N предметов игры (по цене возрастания, начиная с offset). */
export async function grantItems(
  app: NestFastifyApplication,
  userId: string,
  game: string,
  count: number,
  offset = 0,
): Promise<Array<{ userItemId: string; itemId: string; price: number }>> {
  const gid = await gameId(app, game);
  const rows = await db(app)
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(eq(items.gameId, gid), eq(items.isActive, true)))
    .orderBy(asc(items.price))
    .offset(offset)
    .limit(count);
  const inventory = app.get(InventoryService);
  const out = [];
  for (const r of rows) {
    const userItemId = await db(app).transaction((tx) =>
      inventory.grant(tx, { userId, gameId: gid, itemId: r.id, value: r.price, sourceType: 'admin' }),
    );
    out.push({ userItemId, itemId: r.id, price: r.price });
  }
  return out;
}

export async function newPlayer(app: NestFastifyApplication, prefix = 'p'): Promise<{ client: TestClient; me: MeDto }> {
  const client = new TestClient(app);
  await client.loginNewPlayer(prefix);
  const me = (await client.get<MeDto>('/api/v1/me')).body;
  return { client, me };
}

export async function userBalance(app: NestFastifyApplication, userId: string): Promise<number> {
  return app.get(LedgerService).balanceOf(userId);
}

export { users };
