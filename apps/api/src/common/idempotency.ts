import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { idempotencyRequests, type Db, type Tx } from '@gunraid/db';
import { HEADERS } from '@gunraid/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DB } from '../core/tokens.js';
import { AppError } from './app-error.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function stableHash(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(normalize(value) ?? null))
    .digest('hex');
}

/** Ключ из заголовка Idempotency-Key (обязателен для игровых и платёжных действий). */
export function requireIdempotencyKey(req: FastifyRequest): string {
  const raw = req.headers[HEADERS.idempotency];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !KEY_RE.test(key)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400);
  return key;
}

/**
 * Выполняет операцию идемпотентно: ключ фиксируется в той же транзакции, что и сама операция.
 * - повтор с тем же ключом и тем же телом → сохранённый ответ (без повторного списания);
 * - параллельный дубль ждёт первую транзакцию на уникальном индексе и получает её ответ;
 * - если операция упала, ключ откатывается вместе с ней — повтор выполнится заново;
 * - тот же ключ с другим телом → ошибка IDEMPOTENCY_KEY_REUSED.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async run<T>(
    userId: string,
    key: string,
    endpoint: string,
    body: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    const requestHash = stableHash(body);
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(idempotencyRequests)
        .values({ userId, key, endpoint, requestHash, status: 'processing' })
        .onConflictDoNothing()
        .returning({ key: idempotencyRequests.key });
      if (!inserted.length) {
        const [row] = await tx
          .select()
          .from(idempotencyRequests)
          .where(and(eq(idempotencyRequests.userId, userId), eq(idempotencyRequests.key, key)))
          .limit(1);
        if (!row) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409);
        if (row.endpoint !== endpoint || row.requestHash !== requestHash) {
          throw new AppError('IDEMPOTENCY_KEY_REUSED', 422);
        }
        if (row.status === 'done') return { result: row.response as T, replayed: true };
        throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409);
      }
      const result = await fn(tx);
      await tx
        .update(idempotencyRequests)
        .set({ status: 'done', response: result as unknown as object })
        .where(and(eq(idempotencyRequests.userId, userId), eq(idempotencyRequests.key, key)));
      return { result, replayed: false };
    });
  }
}
