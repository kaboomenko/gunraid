import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  authIdentities,
  games,
  newId,
  userGameProfiles,
  users,
  wallets,
  type Db,
  type DbOrTx,
  type IdentityProfile,
} from '@gunraid/db';
import {
  SO2_PLAYER_ID_RE,
  parseTradeUrl,
  steamIdToAccountId,
  type AuthProvider,
  type GameProfileBody,
  type GameProfileDto,
  type MeDto,
  type PublicUserDto,
  type Role,
  type UpdateSettingsBody,
} from '@gunraid/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, badRequest, conflict, notFound } from '../../common/app-error.js';
import { GamesService } from '../games/games.service.js';

export type UserRow = typeof users.$inferSelect;

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomReferralCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return out;
}

/** Приводит ник из соцсети к допустимому виду. */
export function sanitizeNickname(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_\-. ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
  if (cleaned.length >= 2) return cleaned;
  return `Player${randomInt(1000, 10000)}`;
}

export interface CreateUserInput {
  nickname: string;
  avatarUrl?: string | null;
  role?: Role;
  selectedGameId?: number | null;
  referredById?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly games: GamesService,
  ) {}

  async getAuthInfo(userId: string) {
    const [row] = await this.db
      .select({ role: users.role, status: users.status, adultConfirmedAt: users.adultConfirmedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async findById(userId: string, tx: DbOrTx = this.db): Promise<UserRow | null> {
    const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  }

  async findByReferralCode(code: string, tx: DbOrTx = this.db): Promise<UserRow | null> {
    if (!/^[A-Z0-9]{4,16}$/i.test(code)) return null;
    const [row] = await tx
      .select()
      .from(users)
      .where(eq(users.referralCode, code.toUpperCase()))
      .limit(1);
    return row ?? null;
  }

  /** Новый пользователь + кошелёк с нулевым балансом. */
  async createUser(tx: DbOrTx, input: CreateUserInput): Promise<UserRow> {
    let referralCode = randomReferralCode();
    for (let i = 0; i < 5; i++) {
      const [exists] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, referralCode))
        .limit(1);
      if (!exists) break;
      referralCode = randomReferralCode(10);
    }
    const [row] = await tx
      .insert(users)
      .values({
        id: newId(),
        nickname: sanitizeNickname(input.nickname),
        avatarUrl: input.avatarUrl ?? null,
        role: input.role ?? 'user',
        referralCode,
        selectedGameId: input.selectedGameId ?? null,
        referredById: input.referredById ?? null,
        lastSeenAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('user insert failed');
    await tx.insert(wallets).values({ userId: row.id, balance: 0 });
    return row;
  }

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.findById(userId);
    if (!user) throw notFound();
    const [wallet] = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    const identities = await this.db
      .select({
        provider: authIdentities.provider,
        profile: authIdentities.profile,
        createdAt: authIdentities.createdAt,
      })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));
    const profiles = await this.db
      .select({
        code: games.code,
        tradeUrl: userGameProfiles.tradeUrl,
        playerId: userGameProfiles.playerId,
      })
      .from(userGameProfiles)
      .innerJoin(games, eq(games.id, userGameProfiles.gameId))
      .where(eq(userGameProfiles.userId, userId));

    const gameProfiles: Record<string, GameProfileDto> = {};
    for (const g of await this.games.listActive()) {
      gameProfiles[g.code] = { tradeUrl: null, playerId: null };
    }
    for (const p of profiles) gameProfiles[p.code] = { tradeUrl: p.tradeUrl, playerId: p.playerId };

    const selectedGame = user.selectedGameId
      ? ((await this.games.findById(user.selectedGameId))?.code ?? null)
      : null;

    return {
      id: user.id,
      shortId: user.shortId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      role: user.role,
      level: user.level,
      xp: user.xp,
      balance: wallet?.balance ?? 0,
      adultConfirmed: Boolean(user.adultConfirmedAt),
      selectedGame,
      settings: { soundEnabled: user.soundEnabled, fastModeDefault: user.fastModeDefault },
      identities: identities.map((i) => ({
        provider: i.provider,
        displayName: displayNameOf(i.provider, i.profile),
        linkedAt: i.createdAt.toISOString(),
      })),
      gameProfiles,
      referralCode: user.referralCode,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async confirmAge(userId: string, ip: string | null): Promise<void> {
    await this.db
      .update(users)
      .set({ adultConfirmedAt: sql`coalesce(${users.adultConfirmedAt}, now())`, adultConfirmedIp: ip, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
  }

  async updateSettings(userId: string, body: UpdateSettingsBody): Promise<void> {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (body.soundEnabled !== undefined) patch.soundEnabled = body.soundEnabled;
    if (body.fastModeDefault !== undefined) patch.fastModeDefault = body.fastModeDefault;
    if (body.nickname !== undefined) patch.nickname = sanitizeNickname(body.nickname);
    if (body.selectedGame !== undefined) {
      patch.selectedGameId = (await this.games.getActive(body.selectedGame)).id;
    }
    if (!Object.keys(patch).length) return;
    await this.db
      .update(users)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
  }

  async setGameProfile(userId: string, gameCode: string, body: GameProfileBody): Promise<void> {
    const game = await this.games.getActive(gameCode);
    const values: { tradeUrl?: string | null; playerId?: string | null } = {};

    if (body.tradeUrl !== undefined) {
      if (game.features.withdrawTarget !== 'trade_url') throw badRequest('VALIDATION_ERROR');
      if (body.tradeUrl === null || body.tradeUrl === '') {
        values.tradeUrl = null;
      } else {
        const parsed = parseTradeUrl(body.tradeUrl);
        if (!parsed) throw badRequest('TRADE_URL_INVALID');
        const [steam] = await this.db
          .select({ providerUserId: authIdentities.providerUserId })
          .from(authIdentities)
          .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'steam')))
          .limit(1);
        if (steam && steamIdToAccountId(steam.providerUserId) !== parsed.partner) {
          throw badRequest('TRADE_URL_STEAM_MISMATCH');
        }
        values.tradeUrl = body.tradeUrl.trim();
      }
    }
    if (body.playerId !== undefined) {
      if (game.features.withdrawTarget !== 'player_id') throw badRequest('VALIDATION_ERROR');
      if (body.playerId === null || body.playerId === '') {
        values.playerId = null;
      } else {
        if (!SO2_PLAYER_ID_RE.test(body.playerId)) throw badRequest('PLAYER_ID_INVALID');
        values.playerId = body.playerId;
      }
    }
    if (!Object.keys(values).length) return;
    await this.db
      .insert(userGameProfiles)
      .values({ userId, gameId: game.id, ...values })
      .onConflictDoUpdate({
        target: [userGameProfiles.userId, userGameProfiles.gameId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }

  async unlinkIdentity(userId: string, provider: AuthProvider): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const [{ value: total } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId));
      if (total <= 1) throw conflict('LAST_IDENTITY');
      const deleted = await tx
        .delete(authIdentities)
        .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, provider)))
        .returning({ id: authIdentities.id });
      if (!deleted.length) throw notFound();
    });
  }

  async getPublicProfile(shortId: number): Promise<PublicUserDto> {
    const [row] = await this.db
      .select({
        shortId: users.shortId,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
        level: users.level,
        createdAt: users.createdAt,
        status: users.status,
      })
      .from(users)
      .where(eq(users.shortId, shortId))
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', 404);
    return {
      shortId: row.shortId,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      level: row.level,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function displayNameOf(provider: AuthProvider, profile: IdentityProfile): string {
  if (provider === 'telegram' && profile.username) return `@${profile.username}`;
  if (provider === 'google' && profile.email) return profile.email;
  return profile.displayName ?? provider;
}
