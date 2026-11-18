import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { newId } from '../ids.js';
import {
  adminAuditLog,
  authIdentities,
  inventoryEvents,
  ledgerEntries,
  userItems,
  users,
  wallets,
} from '../schema/index.js';
import { pickDemoItems } from './catalog.js';

const PRESETS = [
  { key: 'player', nickname: 'DevPlayer', role: 'user' as const, gems: 5000, items: 10 },
  { key: 'support', nickname: 'DevSupport', role: 'support' as const, gems: 0, items: 0 },
  { key: 'admin', nickname: 'DevAdmin', role: 'admin' as const, gems: 0, items: 0 },
];

const DEMO_REASON = 'Демо-баланс для локального запуска (сид)';

/**
 * Тестовые пользователи для dev-входа (только вне production): DevPlayer получает
 * демо-баланс через ledger (admin_adjustment с причиной + аудит) и демо-инвентарь.
 */
export async function seedDevUsers(db: Db): Promise<void> {
  for (const p of PRESETS) {
    const providerUserId = `preset:${p.key}`;
    let [identity] = await db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, 'dev'), eq(authIdentities.providerUserId, providerUserId)))
      .limit(1);
    let userId = identity?.userId;
    if (!userId) {
      userId = newId();
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId as string,
          nickname: p.nickname,
          role: p.role,
          referralCode: `DEV${p.key.toUpperCase()}`.slice(0, 10),
        });
        await tx.insert(wallets).values({ userId: userId as string, balance: 0 });
        await tx.insert(authIdentities).values({
          id: newId(),
          userId: userId as string,
          provider: 'dev',
          providerUserId,
          profile: { displayName: p.nickname },
        });
      });
      [identity] = await db
        .select()
        .from(authIdentities)
        .where(eq(authIdentities.providerUserId, providerUserId))
        .limit(1);
    }

    if (p.gems > 0) {
      await db.transaction(async (tx) => {
        const key = `seed:demo-balance:${userId}`;
        const [exists] = await tx
          .select({ id: ledgerEntries.id })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.idempotencyKey, key))
          .limit(1);
        if (exists) return;
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userId as string))
          .for('update');
        const balanceAfter = (wallet?.balance ?? 0) + p.gems;
        const [entry] = await tx
          .insert(ledgerEntries)
          .values({
            userId: userId as string,
            type: 'admin_adjustment',
            amount: p.gems,
            balanceAfter,
            refType: 'seed',
            idempotencyKey: key,
            reason: DEMO_REASON,
          })
          .returning({ id: ledgerEntries.id });
        await tx
          .update(wallets)
          .set({ balance: balanceAfter, lastEntryId: entry?.id ?? null, updatedAt: sql`now()` })
          .where(eq(wallets.userId, userId as string));
        await tx.insert(adminAuditLog).values({
          actorId: null,
          action: 'balance.adjust',
          entityType: 'user',
          entityId: userId as string,
          after: { amount: p.gems, balanceAfter },
          reason: DEMO_REASON,
        });
      });
    }

    if (p.items > 0) {
      const [has] = await db
        .select({ id: userItems.id })
        .from(userItems)
        .where(eq(userItems.userId, userId as string))
        .limit(1);
      if (!has) {
        for (const game of ['standoff2', 'cs2']) {
          const picked = await pickDemoItems(db, game, p.items);
          for (const it of picked) {
            const id = newId();
            await db.insert(userItems).values({
              id,
              userId: userId as string,
              gameId: it.gameId,
              itemId: it.id,
              acquiredValue: it.price,
              sourceType: 'seed',
            });
            await db.insert(inventoryEvents).values({
              userItemId: id,
              userId: userId as string,
              type: 'acquired',
              value: it.price,
              refType: 'seed',
            });
          }
        }
      }
    }
  }
}
