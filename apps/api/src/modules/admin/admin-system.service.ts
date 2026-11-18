import { Inject, Injectable } from '@nestjs/common';
import { adminAuditLog, deposits, fxRates, users, type Db } from '@gunraid/db';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  type AdminAuditRowDto,
  type AdminDepositDto,
  type AdminPageDto,
  type AdminSettingsDto,
  type AllSettings,
  type FxRateDto,
  type SettingsKey,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { notFound } from '../../common/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Настройки (включая курс гемов), курсы валют оплаты, пополнения, журнал аудита. */
@Injectable()
export class AdminSystemService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async allSettings(): Promise<AdminSettingsDto> {
    const values = {} as Record<SettingsKey, unknown>;
    for (const key of SETTINGS_KEYS) values[key] = await this.settings.get(key);
    return { values: values as AllSettings, defaults: DEFAULT_SETTINGS };
  }

  async putSetting(
    actorId: string,
    key: SettingsKey,
    value: unknown,
    ip: string | null,
  ): Promise<unknown> {
    const before = await this.settings.get(key);
    return this.db.transaction(async (tx) => {
      const saved = await this.settings.set(key, value, actorId, tx);
      await this.audit.log(
        {
          actorId,
          action: 'settings.update',
          entityType: 'settings',
          entityId: key,
          before,
          after: saved,
          ip,
        },
        tx,
      );
      return saved;
    });
  }

  async fxRatesList(): Promise<FxRateDto[]> {
    const rows = await this.db.select().from(fxRates).orderBy(asc(fxRates.sortOrder));
    return rows.map((r) => ({
      currency: r.currency,
      usdRate: r.usdRate,
      source: r.source,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async putFxRate(
    actorId: string,
    currency: string,
    usdRate: string,
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(fxRates)
        .where(eq(fxRates.currency, currency))
        .for('update');
      if (!before) throw notFound();
      await tx
        .update(fxRates)
        .set({ usdRate, source: 'manual', updatedAt: new Date() })
        .where(eq(fxRates.currency, currency));
      await this.audit.log(
        {
          actorId,
          action: 'fx_rate.update',
          entityType: 'fx_rate',
          entityId: currency,
          before: { usdRate: before.usdRate },
          after: { usdRate },
          ip,
        },
        tx,
      );
    });
  }

  async depositsPage(
    status: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<AdminPageDto<AdminDepositDto>> {
    const where: SQL | undefined = status
      ? eq(deposits.status, status as typeof deposits.$inferSelect.status)
      : undefined;
    const [rows, [agg]] = await Promise.all([
      this.db
        .select({ d: deposits, shortId: users.shortId, nickname: users.nickname })
        .from(deposits)
        .innerJoin(users, eq(users.id, deposits.userId))
        .where(where)
        .orderBy(desc(deposits.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(deposits).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.d.id,
        user: { id: r.d.userId, shortId: r.shortId, nickname: r.nickname },
        provider: r.d.provider,
        method: r.d.method,
        payCurrency: r.d.payCurrency,
        payAmount: r.d.payAmount,
        gemsAmount: r.d.gemsAmount,
        bonusGems: r.d.bonusGems + r.d.entitlementBonusGems,
        status: r.d.status,
        createdAt: r.d.createdAt.toISOString(),
        completedAt: r.d.completedAt?.toISOString() ?? null,
      })),
      total: agg?.n ?? 0,
      page,
      pageSize,
    };
  }

  async auditPage(
    entityType: string | undefined,
    entityId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<AdminPageDto<AdminAuditRowDto>> {
    const where: SQL[] = [];
    if (entityType) where.push(eq(adminAuditLog.entityType, entityType));
    if (entityId) where.push(eq(adminAuditLog.entityId, entityId));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(adminAuditLog)
        .where(cond)
        .orderBy(desc(adminAuditLog.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(adminAuditLog).where(cond),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const actors = actorIds.length
      ? await this.db
          .select({ id: users.id, nickname: users.nickname })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
    const map = new Map(actors.map((a) => [a.id, a]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        actor: r.actorId ? (map.get(r.actorId) ?? { id: r.actorId, nickname: '' }) : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        reason: r.reason,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total: agg?.n ?? 0,
      page,
      pageSize,
    };
  }
}
