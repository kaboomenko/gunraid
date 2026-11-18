import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COOKIES } from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../../common/app-error.js';
import { AUTH_OPTIONS, type AuthOptions } from '../../common/auth.decorators.js';
import { UsersService } from '../users/users.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

/**
 * Глобальный guard: для маршрутов с @Auth() требует вход (и роли / 18+),
 * для @OptionalAuth() подставляет пользователя, если он вошёл.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const opts = this.reflector.getAllAndOverride<AuthOptions | undefined>(AUTH_OPTIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    req.auth = null;
    if (!opts) return true;

    const fail = (err: Error): boolean => {
      if (opts.required) throw err;
      return true;
    };

    const token = req.cookies?.[COOKIES.access];
    if (!token) return fail(unauthorized());

    let claims: { userId: string; sessionId: string };
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch (err) {
      return fail(err as Error);
    }
    if (!(await this.sessions.isActive(claims.sessionId)))
      return fail(unauthorized('SESSION_REVOKED'));

    const info = await this.users.getAuthInfo(claims.userId);
    if (!info) return fail(unauthorized());
    if (info.status === 'banned') return fail(forbidden('USER_BANNED'));

    req.auth = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      role: info.role,
      adultConfirmed: Boolean(info.adultConfirmedAt),
    };
    if (opts.roles?.length && !opts.roles.includes(info.role)) throw forbidden();
    if (opts.adult && !req.auth.adultConfirmed) throw forbidden('ADULT_CONFIRMATION_REQUIRED');
    return true;
  }
}
