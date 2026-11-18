import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_PREFIX, COOKIES, type Role } from '@gunraid/shared';
import type { FastifyReply } from 'fastify';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Env } from '../../config/env.js';
import { ENV } from '../../core/tokens.js';
import { unauthorized } from '../../common/app-error.js';

const ISSUER = 'gunraid';
const AUDIENCE = 'gunraid-web';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

@Injectable()
export class TokensService {
  private readonly accessKey: Uint8Array;
  private readonly stateKey: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.stateKey = createHash('sha256').update(`oauth-state:${env.COOKIE_SECRET}`).digest();
  }

  async signAccess(p: { userId: string; sessionId: string; role: Role }): Promise<string> {
    return new SignJWT({ sid: p.sessionId, role: p.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.accessKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw unauthorized();
      }
      return { userId: payload.sub, sessionId: payload.sid };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw unauthorized('TOKEN_EXPIRED');
      throw unauthorized('UNAUTHORIZED');
    }
  }

  /** Подписанное короткоживущее состояние OAuth-потока (cookie gr_oauth). */
  async signState(payload: Record<string, unknown>): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(this.stateKey);
  }

  async verifyState<T extends Record<string, unknown>>(token: string | undefined): Promise<T | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.stateKey, { algorithms: ['HS256'] });
      return payload as T;
    } catch {
      return null;
    }
  }

  newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private cookieBase() {
    return { httpOnly: true, sameSite: 'lax' as const, secure: this.env.COOKIE_SECURE };
  }

  setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
    const maxAge = this.env.REFRESH_TOKEN_TTL_DAYS * 86_400;
    reply.setCookie(COOKIES.access, accessToken, { ...this.cookieBase(), path: '/', maxAge });
    reply.setCookie(COOKIES.refresh, refreshToken, {
      ...this.cookieBase(),
      path: `${API_PREFIX}/auth`,
      maxAge,
    });
  }

  clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(COOKIES.access, { ...this.cookieBase(), path: '/' });
    reply.clearCookie(COOKIES.refresh, { ...this.cookieBase(), path: `${API_PREFIX}/auth` });
  }

  setStateCookie(reply: FastifyReply, value: string): void {
    reply.setCookie(COOKIES.oauth, value, {
      ...this.cookieBase(),
      path: `${API_PREFIX}/auth`,
      maxAge: 600,
    });
  }

  clearStateCookie(reply: FastifyReply): void {
    reply.clearCookie(COOKIES.oauth, { ...this.cookieBase(), path: `${API_PREFIX}/auth` });
  }
}
