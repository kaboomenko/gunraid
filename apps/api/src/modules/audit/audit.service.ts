import { Inject, Injectable } from '@nestjs/common';
import { adminAuditLog, type Db, type DbOrTx } from '@gunraid/db';
import { DB } from '../../core/tokens.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** Аудит-лог: все действия админов и изменения баланса вне игровой логики. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(entry: AuditEntry, tx: DbOrTx = this.db): Promise<void> {
    await tx.insert(adminAuditLog).values({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
    });
  }
}
