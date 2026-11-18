import { Inject, Injectable } from '@nestjs/common';
import { newId, sessions, type Db } from '@gunraid/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { rkey } from '../../core/redis.js';
import { DB, ENV, REDIS } from '../../core/tokens.js';
import { AppError, unauthorized } from '../../common/app-error.js';
import type { RequestMeta } from '../../common/http-context.js';
import { TokensService } from './tokens.service.js';

/** Если «старый» refresh пришёл повторно в течение этого окна — это гонка вкладок, а не кража. */
const ROTATION_GRACE_MS = 30_000;
const CACHE_TTL_SEC = 3600;

export interface IssuedSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokensService,
  ) {}

  private cacheKey(sessionId: string): string {
    return rkey(this.env, 'sess', sessionId);
  }

  private expiresAt(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  async create(userId: string, meta: RequestMeta, familyId: string = newId()): Promise<IssuedSession> {
    const refreshToken = this.tokens.newRefreshToken();
    const id = newId();
    await this.db.insert(sessions).values({
      id,
      userId,
      familyId,
      refreshTokenHash: this.tokens.hashToken(refreshToken),
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceId: meta.deviceId,
      expiresAt: this.expiresAt(),
    });
    await this.redis.set(this.cacheKey(id), '1', 'EX', CACHE_TTL_SEC);
    return { sessionId: id, userId, refreshToken };
  }

  /** Ротация refresh-токена с обнаружением повторного использования. */
  async rotate(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken) throw unauthorized('REFRESH_INVALID');
    const hash = this.tokens.hashToken(refreshToken);

    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, hash))
        .for('update')
        .limit(1);
      if (!row) return { kind: 'invalid' as const };
      if (row.revokedAt) {
        if (row.revokeReason === 'rotated') {
          const age = Date.now() - row.revokedAt.getTime();
          if (age <= ROTATION_GRACE_MS) return { kind: 'race' as const };
          await tx
            .update(sessions)
            .set({ revokedAt: sql`now()`, revokeReason: 'reuse_detected' })
            .where(and(eq(sessions.familyId, row.familyId), isNull(sessions.revokedAt)));
          return { kind: 'reused' as const, familyId: row.familyId };
        }
        return { kind: 'invalid' as const };
      }
      if (row.expiresAt.getTime() <= Date.now()) return { kind: 'invalid' as const };

      const nextToken = this.tokens.newRefreshToken();
      const nextId = newId();
      await tx.insert(sessions).values({
        id: nextId,
        userId: row.userId,
        familyId: row.familyId,
        refreshTokenHash: this.tokens.hashToken(nextToken),
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceId: meta.deviceId,
        expiresAt: this.expiresAt(),
      });
      await tx
        .update(sessions)
        .set({ revokedAt: sql`now()`, revokeReason: 'rotated', replacedById: nextId, lastUsedAt: sql`now()` })
        .where(eq(sessions.id, row.id));
      return {
        kind: 'ok' as const,
        oldId: row.id,
        session: { sessionId: nextId, userId: row.userId, refreshToken: nextToken },
      };
    });

    switch (outcome.kind) {
      case 'invalid':
        throw unauthorized('REFRESH_INVALID');
      case 'race':
        throw new AppError('REFRESH_RACE', 409);
      case 'reused': {
        await this.dropFamilyCache(outcome.familyId);
        throw unauthorized('REFRESH_REUSED');
      }
      case 'ok':
        await this.redis
          .multi()
          .set(this.cacheKey(outcome.oldId), '0', 'EX', CACHE_TTL_SEC)
          .set(this.cacheKey(outcome.session.sessionId), '1', 'EX', CACHE_TTL_SEC)
          .exec();
        return outcome.session;
    }
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    await this.redis.set(this.cacheKey(sessionId), '0', 'EX', CACHE_TTL_SEC);
  }

  async revokeByRefreshToken(refreshToken: string, reason: string): Promise<void> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.refreshTokenHash, this.tokens.hashToken(refreshToken)), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    for (const r of rows) await this.redis.set(this.cacheKey(r.id), '0', 'EX', CACHE_TTL_SEC);
  }

  /** «Выйти со всех устройств»: отзыв всех сессий пользователя, действует сразу. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (rows.length) {
      const multi = this.redis.multi();
      for (const r of rows) multi.set(this.cacheKey(r.id), '0', 'EX', CACHE_TTL_SEC);
      await multi.exec();
    }
    return rows.length;
  }

  async isActive(sessionId: string): Promise<boolean> {
    const cached = await this.redis.get(this.cacheKey(sessionId));
    if (cached === '1') return true;
    if (cached === '0') return false;
    const [row] = await this.db
      .select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    const active = !!row && !row.revokedAt && row.expiresAt.getTime() > Date.now();
    await this.redis.set(this.cacheKey(sessionId), active ? '1' : '0', 'EX', CACHE_TTL_SEC);
    return active;
  }

  private async dropFamilyCache(familyId: string): Promise<void> {
    const rows = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.familyId, familyId));
    if (!rows.length) return;
    const multi = this.redis.multi();
    for (const r of rows) multi.set(this.cacheKey(r.id), '0', 'EX', CACHE_TTL_SEC);
    await multi.exec();
  }
}
