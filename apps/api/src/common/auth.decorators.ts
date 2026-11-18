import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import type { RateLimitBucket } from '../modules/rate-limit/rate-limit.service.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  adultConfirmed: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext | null;
  }
}

export interface AuthOptions {
  required: boolean;
  roles?: Role[];
  /** Требовать подтверждение 18+ (все игровые действия). */
  adult?: boolean;
}

export const AUTH_OPTIONS = 'gr:auth';
export const RATE_LIMIT = 'gr:rate-limit';

/** Маршрут только для вошедших; опционально — роли и подтверждённые 18+. */
export const Auth = (opts: { roles?: Role[]; adult?: boolean } = {}) =>
  SetMetadata(AUTH_OPTIONS, { required: true, ...opts } satisfies AuthOptions);

/** Пользователь подставляется, если вошёл; гостям тоже можно. */
export const OptionalAuth = () => SetMetadata(AUTH_OPTIONS, { required: false } satisfies AuthOptions);

export const RateLimit = (...buckets: RateLimitBucket[]) => SetMetadata(RATE_LIMIT, buckets);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | null =>
    ctx.switchToHttp().getRequest<FastifyRequest>().auth ?? null,
);
