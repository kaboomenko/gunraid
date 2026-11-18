import { Inject, Injectable } from '@nestjs/common';
import { cases, games, newId, userEntitlements, type Db, type DbOrTx } from '@gunraid/db';
import type { BonusSource, EntitlementDto, EntitlementType } from '@gunraid/shared';
import { and, asc, count, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { localize } from '../catalog/item-mapper.js';

type Row = typeof userEntitlements.$inferSelect;

export interface GrantEntitlementInput {
  userId: string;
  type: EntitlementType;
  caseId?: string | null;
  percent?: number | null;
  maxAmount?: number | null;
  sourceType: BonusSource;
  sourceId?: string | null;
  expiresAt?: Date | null;
}

/** «Права» пользователя: бесплатный кейс, доп. вращение колеса, бонус к пополнению. */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private activeCond(userId: string, type: EntitlementType) {
    return and(
      eq(userEntitlements.userId, userId),
      eq(userEntitlements.type, type),
      eq(userEntitlements.status, 'active'),
      or(isNull(userEntitlements.expiresAt), gt(userEntitlements.expiresAt, sql`now()`)),
    )!;
  }

  async grant(tx: DbOrTx, input: GrantEntitlementInput): Promise<string> {
    const id = newId();
    await tx.insert(userEntitlements).values({
      id,
      userId: input.userId,
      type: input.type,
      caseId: input.caseId ?? null,
      percent: input.percent ?? null,
      maxAmount: input.maxAmount ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    return id;
  }

  async count(
    userId: string,
    type: EntitlementType,
    caseId?: string,
    tx: DbOrTx = this.db,
  ): Promise<number> {
    const cond = caseId
      ? and(this.activeCond(userId, type), eq(userEntitlements.caseId, caseId))
      : this.activeCond(userId, type);
    const [row] = await tx.select({ n: count() }).from(userEntitlements).where(cond);
    return row?.n ?? 0;
  }

  /**
   * Блокирует одно активное право (самое старое). SKIP LOCKED: параллельный запрос возьмёт другое
   * право или не найдёт ни одного — одно право не используется дважды.
   */
  async lockOne(
    tx: DbOrTx,
    userId: string,
    type: EntitlementType,
    caseId?: string,
  ): Promise<Row | null> {
    const cond = caseId
      ? and(this.activeCond(userId, type), eq(userEntitlements.caseId, caseId))
      : this.activeCond(userId, type);
    const [row] = await tx
      .select()
      .from(userEntitlements)
      .where(cond)
      .orderBy(asc(userEntitlements.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    return row ?? null;
  }

  async lockById(tx: DbOrTx, id: string): Promise<Row | null> {
    const [row] = await tx
      .select()
      .from(userEntitlements)
      .where(eq(userEntitlements.id, id))
      .for('update');
    return row ?? null;
  }

  isUsable(row: Row): boolean {
    return row.status === 'active' && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
  }

  async consume(tx: DbOrTx, id: string, refId: string | null): Promise<void> {
    await tx
      .update(userEntitlements)
      .set({ status: 'used', usedAt: sql`now()`, usedRefId: refId })
      .where(eq(userEntitlements.id, id));
  }

  /** Лучший бонус к пополнению для суммы gems: max(min(gems × %, потолок)). */
  async bestDepositBonus(
    userId: string,
    gems: number,
    tx: DbOrTx = this.db,
  ): Promise<{ id: string; percent: number; bonus: number } | null> {
    const rows = await tx
      .select()
      .from(userEntitlements)
      .where(this.activeCond(userId, 'deposit_bonus'));
    let best: { id: string; percent: number; bonus: number } | null = null;
    for (const r of rows) {
      const raw = Math.floor(gems * Number(r.percent ?? 0));
      const bonus = r.maxAmount !== null ? Math.min(raw, r.maxAmount) : raw;
      if (bonus > 0 && (!best || bonus > best.bonus))
        best = { id: r.id, percent: Number(r.percent), bonus };
    }
    return best;
  }

  async list(userId: string): Promise<EntitlementDto[]> {
    const rows = await this.db
      .select({
        e: userEntitlements,
        caseSlug: cases.slug,
        caseName: cases.name,
        caseImage: cases.imageUrl,
        casePrice: cases.price,
        gameCode: games.code,
      })
      .from(userEntitlements)
      .leftJoin(cases, eq(cases.id, userEntitlements.caseId))
      .leftJoin(games, eq(games.id, cases.gameId))
      .where(
        and(
          eq(userEntitlements.userId, userId),
          eq(userEntitlements.status, 'active'),
          or(isNull(userEntitlements.expiresAt), gt(userEntitlements.expiresAt, sql`now()`)),
        ),
      )
      .orderBy(asc(userEntitlements.createdAt));
    return rows.map((r) => ({
      id: r.e.id,
      type: r.e.type,
      case:
        r.e.caseId && r.caseSlug && r.gameCode
          ? {
              id: r.e.caseId,
              slug: r.caseSlug,
              name: localize(r.caseName),
              imageUrl: r.caseImage ?? null,
              game: r.gameCode,
              price: r.casePrice ?? 0,
            }
          : null,
      percent: r.e.percent !== null ? Number(r.e.percent) : null,
      maxAmount: r.e.maxAmount,
      source: r.e.sourceType,
      expiresAt: r.e.expiresAt?.toISOString() ?? null,
      createdAt: r.e.createdAt.toISOString(),
    }));
  }
}
