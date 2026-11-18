import { Inject, Injectable } from '@nestjs/common';
import { outboxEvents, type Db, type DbOrTx } from '@gunraid/db';
import { DB } from '../../core/tokens.js';

export type OutboxEventType =
  'case.opened' | 'drop.created' | 'deposit.succeeded' | 'battle.finished';

/** Запись доменного события в той же транзакции, что и операция (transactional outbox). */
@Injectable()
export class OutboxService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async add(
    tx: DbOrTx,
    type: OutboxEventType,
    payload: Record<string, unknown>,
    delayMs = 0,
  ): Promise<void> {
    await tx.insert(outboxEvents).values({
      type,
      payload,
      availableAt: new Date(Date.now() + Math.max(0, delayMs)),
    });
  }
}
