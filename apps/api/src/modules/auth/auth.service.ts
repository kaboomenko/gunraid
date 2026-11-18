import { Inject, Injectable } from '@nestjs/common';
import { authIdentities, userAccessLog, users, type Db, type IdentityProfile } from '@gunraid/db';
import type { AuthIntent, AuthProvider, Role } from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { conflict, forbidden } from '../../common/app-error.js';
import type { RequestMeta } from '../../common/http-context.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';

export interface CompleteAuthInput {
  provider: AuthProvider;
  providerUserId: string;
  profile: IdentityProfile;
  intent: AuthIntent;
  /** Для привязки: пользователь, который начал поток (из подписанного state). */
  linkUserId?: string | null;
  /** Роль для dev-пресетов. */
  forceRole?: Role;
  gameCookie?: string;
  referralCookie?: string;
}

export interface CompleteAuthResult {
  userId: string;
  role: Role;
  created: boolean;
  linked: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly users: UsersService,
    private readonly games: GamesService,
  ) {}

  /** Вход или привязка учётки провайдера. Один аккаунт — до одной учётки каждого провайдера. */
  async completeAuth(input: CompleteAuthInput): Promise<CompleteAuthResult> {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, input.provider),
            eq(authIdentities.providerUserId, input.providerUserId),
          ),
        )
        .for('update')
        .limit(1);

      if (input.intent === 'link' && input.linkUserId) {
        const owner = await this.users.findById(input.linkUserId, tx);
        if (!owner) throw forbidden();
        if (owner.status === 'banned') throw forbidden('USER_BANNED');
        if (identity) {
          if (identity.userId !== owner.id) throw conflict('IDENTITY_ALREADY_LINKED');
          await tx
            .update(authIdentities)
            .set({ profile: input.profile, lastLoginAt: sql`now()` })
            .where(eq(authIdentities.id, identity.id));
          return { userId: owner.id, role: owner.role, created: false, linked: true };
        }
        const [sameProvider] = await tx
          .select({ id: authIdentities.id })
          .from(authIdentities)
          .where(
            and(eq(authIdentities.userId, owner.id), eq(authIdentities.provider, input.provider)),
          )
          .limit(1);
        if (sameProvider)
          throw conflict('IDENTITY_ALREADY_LINKED', { reason: 'provider_already_linked' });
        await tx.insert(authIdentities).values({
          id: crypto.randomUUID(),
          userId: owner.id,
          provider: input.provider,
          providerUserId: input.providerUserId,
          profile: input.profile,
        });
        return { userId: owner.id, role: owner.role, created: false, linked: true };
      }

      if (identity) {
        const user = await this.users.findById(identity.userId, tx);
        if (!user) throw forbidden();
        if (user.status === 'banned') throw forbidden('USER_BANNED');
        await tx
          .update(authIdentities)
          .set({ profile: input.profile, lastLoginAt: sql`now()` })
          .where(eq(authIdentities.id, identity.id));
        let role = user.role;
        if (input.forceRole && input.forceRole !== user.role) {
          role = input.forceRole;
          await tx.update(users).set({ role }).where(eq(users.id, user.id));
        }
        await tx
          .update(users)
          .set({ lastSeenAt: sql`now()` })
          .where(eq(users.id, user.id));
        return { userId: user.id, role, created: false, linked: false };
      }

      const game = input.gameCookie ? await this.games.findByCode(input.gameCookie) : null;
      const referrer = input.referralCookie
        ? await this.users.findByReferralCode(input.referralCookie, tx)
        : null;
      const user = await this.users.createUser(tx, {
        nickname: input.profile.displayName ?? '',
        avatarUrl: input.profile.avatarUrl ?? null,
        role: input.forceRole ?? 'user',
        selectedGameId: game?.isActive ? game.id : null,
        referredById: referrer?.status === 'active' ? referrer.id : null,
      });
      await tx.insert(authIdentities).values({
        id: crypto.randomUUID(),
        userId: user.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        profile: input.profile,
      });
      return { userId: user.id, role: user.role, created: true, linked: false };
    });
  }

  async logAccess(
    userId: string,
    event: 'login' | 'refresh' | 'link',
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.insert(userAccessLog).values({
      userId,
      event,
      ip: meta.ip,
      deviceId: meta.deviceId,
      userAgent: meta.userAgent,
    });
  }
}
