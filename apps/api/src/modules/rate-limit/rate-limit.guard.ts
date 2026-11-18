import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RATE_LIMIT } from '../../common/auth.decorators.js';
import { RateLimitService, type RateLimitBucket } from './rate-limit.service.js';

/** Применяет корзины из @RateLimit(): ключ — пользователь, а для гостей — IP. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const buckets = this.reflector.getAllAndOverride<RateLimitBucket[] | undefined>(RATE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!buckets?.length) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const key = req.auth?.userId ? `u:${req.auth.userId}` : `ip:${req.ip}`;
    for (const bucket of buckets) await this.limits.consume(bucket, key);
    return true;
  }
}
