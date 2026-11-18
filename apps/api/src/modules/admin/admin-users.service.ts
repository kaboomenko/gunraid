import { Inject, Injectable } from '@nestjs/common';
import {
  authIdentities,
  deposits,
  games,
  ledgerEntries,
  userAccessLog,
  userGameProfiles,
  userItems,
  users,
  wallets,
  withdrawals,
  type Db,
} from '@gunraid/db';
import type {
  AdminLedgerRowDto,
  AdminLinkedAccountDto,
  AdminPageDto,
  AdminUserDetailDto,
  AdminUserPatchBody,
  AdminUserRowDto,
  AdminUsersQuery,
} from '@gunraid/shared';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

const userColumns = {
  id: users.id,
  shortId: users.shortId,
  nickname: users.nickname,
  avatarUrl: users.avatarUrl,
  role: users.role,
  status: users.status,
  isSuspicious: users.isSuspicious,
  level: users.level,
  balance: sql<number>`coalesce(${wallets.balance}, 0)::bigint`,
  depositsGems: sql<number>`(select coalesce(sum(d.gems_amount), 0)::bigint from deposits d where d.user_id = ${users.id} and d.status = 'succeeded')`,
  createdAt: users.createdAt,
  lastSeenAt: users.lastSeenAt,
};

type UserRow = {
  id: string;
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
  role: 'user' | 'support' | 'admin';
  status: 'active' | 'banned';
  isSuspicious: boolean;
  level: number;
  balance: number;
  depositsGems: number;
  createdAt: Date;
  lastSeenAt: Date | null;
};

function toRow(r: UserRow): AdminUserRowDto {
  return {
    ...r,
    balance: Number(r.balance),
    depositsGems: Number(r.depositsGems),
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
  };
}

/** Пользователи в админке: поиск, карточка, бан, корректировка баланса (с причиной), флаги, роли. */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async list(q: AdminUsersQuery): Promise<AdminPageDto<AdminUserRowDto>> {
    const where: SQL[] = [];
    if (q.q) {
      const term = q.q.trim();
      const conds: SQL[] = [ilike(users.nickname, `%${term.replace(/[%_]/g, '\\$&')}%`)];
      if (/^\d{1,15}$/.test(term)) conds.push(eq(users.shortId, Number(term)));
      if (/^[0-9a-f-]{36}$/i.test(term)) conds.push(eq(users.id, term));
      where.push(or(...conds)!);
    }
    if (q.status) where.push(eq(users.status, q.status));
    if (q.suspicious) where.push(eq(users.isSuspicious, true));
    if (q.role) where.push(eq(users.role, q.role));
    const cond = where.length ? and(...where) : undefined;
    const [rows, [agg]] = await Promise.all([
      this.db
        .select(userColumns)
        .from(users)
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(cond)
        .orderBy(desc(users.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(users).where(cond),
    ]);
    return {
      items: (rows as UserRow[]).map(toRow),
      total: agg?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Связанные аккаунты: общие IP или устройства в журнале входов (без автоматических банов). */
  async linked(userId: string): Promise<AdminLinkedAccountDto[]> {
    const res = await this.db.execute(sql`
      with mine as (
        select distinct host(ip) as ip, device_id from user_access_log where user_id = ${userId}
      )
      select distinct on (u.id) u.id, u.short_id, u.nickname, u.status, u.is_suspicious,
             case when l.device_id is not null and l.device_id in (select device_id from mine where device_id is not null)
                  then 'device' else 'ip' end as via,
             coalesce(case when l.device_id in (select device_id from mine) then l.device_id end, host(l.ip)) as value
      from user_access_log l
      join users u on u.id = l.user_id
      where l.user_id <> ${userId}
        and (l.device_id in (select device_id from mine where device_id is not null)
             or host(l.ip) in (select ip from mine where ip is not null))
      order by u.id, via
      limit 50
    `);
    return (
      res.rows as Array<{
        id: string;
        short_id: string | number;
        nickname: string;
        status: 'active' | 'banned';
        is_suspicious: boolean;
        via: 'ip' | 'device';
        value: string;
      }>
    ).map((r) => ({
      id: r.id,
      shortId: Number(r.short_id),
      nickname: r.nickname,
      status: r.status,
      isSuspicious: r.is_suspicious,
      via: r.via,
      value: r.value,
    }));
  }

  async detail(userId: string): Promise<AdminUserDetailDto> {
    const [row] = await this.db
      .select({
        ...userColumns,
        banReason: users.banReason,
        suspiciousNote: users.suspiciousNote,
        referralCode: users.referralCode,
        referredById: users.referredById,
      })
      .from(users)
      .leftJoin(wallets, eq(wallets.userId, users.id))
      .where(eq(users.id, userId));
    if (!row) throw notFound();
    const [identities, profiles, access, linked, [dep], [wd], [inv], [ledgerSum], referrer] =
      await Promise.all([
        this.db
          .select({
            provider: authIdentities.provider,
            providerUserId: authIdentities.providerUserId,
            profile: authIdentities.profile,
          })
          .from(authIdentities)
          .where(eq(authIdentities.userId, userId)),
        this.db
          .select({
            game: games.code,
            tradeUrl: userGameProfiles.tradeUrl,
            playerId: userGameProfiles.playerId,
          })
          .from(userGameProfiles)
          .innerJoin(games, eq(games.id, userGameProfiles.gameId))
          .where(eq(userGameProfiles.userId, userId)),
        this.db
          .select()
          .from(userAccessLog)
          .where(eq(userAccessLog.userId, userId))
          .orderBy(desc(userAccessLog.createdAt))
          .limit(30),
        this.linked(userId),
        this.db
          .select({ n: count() })
          .from(deposits)
          .where(and(eq(deposits.userId, userId), eq(deposits.status, 'succeeded'))),
        this.db
          .select({
            n: count(),
            value: sql<number>`coalesce(sum(${withdrawals.value}) filter (where ${withdrawals.status} = 'completed'), 0)::bigint`,
          })
          .from(withdrawals)
          .where(eq(withdrawals.userId, userId)),
        this.db
          .select({ value: sql<number>`coalesce(sum(${userItems.acquiredValue}), 0)::bigint` })
          .from(userItems)
          .where(and(eq(userItems.userId, userId), eq(userItems.status, 'in_inventory'))),
        this.db
          .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::bigint` })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.userId, userId)),
        row.referredById
          ? this.db
              .select({ id: users.id, nickname: users.nickname })
              .from(users)
              .where(eq(users.id, row.referredById))
          : Promise.resolve([]),
      ]);
    const { banReason, suspiciousNote, referralCode, referredById: _r, ...rest } = row;
    void _r;
    return {
      ...toRow(rest as UserRow),
      banReason,
      suspiciousNote,
      referralCode,
      referredBy: referrer[0] ?? null,
      identities: identities.map((i) => ({
        provider: i.provider,
        providerUserId: i.providerUserId,
        displayName: (i.profile as { displayName?: string } | null)?.displayName ?? null,
      })),
      gameProfiles: profiles,
      stats: {
        depositsCount: dep?.n ?? 0,
        withdrawalsCount: wd?.n ?? 0,
        withdrawalsValue: Number(wd?.value ?? 0),
        inventoryValue: Number(inv?.value ?? 0),
        ledgerSum: Number(ledgerSum?.value ?? 0),
      },
      access: access.map((a) => ({
        event: a.event,
        ip: a.ip,
        deviceId: a.deviceId,
        userAgent: a.userAgent,
        createdAt: a.createdAt.toISOString(),
      })),
      linked,
    };
  }

  async ledgerPage(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<AdminPageDto<AdminLedgerRowDto>> {
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.userId, userId))
        .orderBy(desc(ledgerEntries.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(ledgerEntries).where(eq(ledgerEntries.userId, userId)),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        refType: r.refType,
        refId: r.refId,
        reason: r.reason,
        actorId: r.actorId,
        createdAt: r.createdAt.toISOString(),
      })),
      total: agg?.n ?? 0,
      page,
      pageSize,
    };
  }

  /** Ручная корректировка баланса: только через ledger, причина обязательна, запись в аудит. */
  async adjustBalance(
    actorId: string,
    userId: string,
    amount: number,
    reason: string,
    key: string,
    ip: string | null,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const before = await this.ledger.lockWallet(tx, userId);
      const res = await this.ledger.post(tx, {
        userId,
        type: 'admin_adjustment',
        amount,
        refType: 'admin',
        idempotencyKey: `admin_adjust:${key}`,
        actorId,
        reason,
      });
      await this.audit.log(
        {
          actorId,
          action: 'balance.adjust',
          entityType: 'user',
          entityId: userId,
          before: { balance: before },
          after: { balance: res.balanceAfter, amount },
          reason,
          ip,
        },
        tx,
      );
      return res.balanceAfter;
    });
  }

  async ban(actorId: string, userId: string, reason: string, ip: string | null): Promise<void> {
    if (actorId === userId) throw new AppError('FORBIDDEN', 403, { reason: 'self' });
    await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ status: 'banned', banReason: reason, updatedAt: sql`now()` })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!u) throw notFound();
      await this.audit.log(
        { actorId, action: 'user.ban', entityType: 'user', entityId: userId, reason, ip },
        tx,
      );
    });
    await this.sessions.revokeAllForUser(userId, 'banned');
  }

  async unban(actorId: string, userId: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ status: 'active', banReason: null, updatedAt: sql`now()` })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!u) throw notFound();
      await this.audit.log(
        { actorId, action: 'user.unban', entityType: 'user', entityId: userId, ip },
        tx,
      );
    });
  }

  async patch(
    actor: { userId: string; role: string },
    userId: string,
    body: AdminUserPatchBody,
    ip: string | null,
  ): Promise<void> {
    if (body.role !== undefined && actor.role !== 'admin') throw new AppError('FORBIDDEN', 403);
    if (body.role !== undefined && actor.userId === userId) {
      throw new AppError('FORBIDDEN', 403, { reason: 'self' });
    }
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          isSuspicious: users.isSuspicious,
          suspiciousNote: users.suspiciousNote,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!before) throw notFound();
      const set: Partial<typeof users.$inferInsert> = {};
      if (body.isSuspicious !== undefined) set.isSuspicious = body.isSuspicious;
      if (body.suspiciousNote !== undefined) set.suspiciousNote = body.suspiciousNote;
      if (body.role !== undefined) set.role = body.role;
      await tx
        .update(users)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(users.id, userId));
      await this.audit.log(
        {
          actorId: actor.userId,
          action: 'user.update',
          entityType: 'user',
          entityId: userId,
          before,
          after: body,
          ip,
        },
        tx,
      );
    });
    if (body.role !== undefined) await this.sessions.revokeAllForUser(userId, 'role_changed');
  }
}
