import { randomBytes, timingSafeEqual } from 'node:crypto';
import { API_PREFIX, COOKIES, HEADERS } from '@gunraid/shared';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PREFIXES = [`${API_PREFIX}/payments/webhook/`, `${API_PREFIX}/health`];
const TWO_YEARS = 60 * 60 * 24 * 730;
const ONE_YEAR = 60 * 60 * 24 * 365;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Хуки безопасности уровня Fastify (до роутинга Nest):
 * - долгоживущий device-id (антимультиаккаунт);
 * - CSRF double-submit: cookie gr_csrf + заголовок x-csrf-token на всех мутирующих запросах.
 */
export function registerSecurityHooks(fastify: FastifyInstance, env: Env): void {
  const base = { path: '/', sameSite: 'lax' as const, secure: env.COOKIE_SECURE };

  fastify.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(API_PREFIX)) return;

    if (!req.cookies[COOKIES.device]) {
      const id = randomBytes(18).toString('base64url');
      req.cookies[COOKIES.device] = id;
      reply.setCookie(COOKIES.device, id, { ...base, httpOnly: true, maxAge: TWO_YEARS });
    }

    const csrfCookie = req.cookies[COOKIES.csrf];
    if (!csrfCookie) {
      reply.setCookie(COOKIES.csrf, randomBytes(24).toString('base64url'), {
        ...base,
        httpOnly: false,
        maxAge: ONE_YEAR,
      });
    }

    if (SAFE_METHODS.has(req.method)) return;
    if (CSRF_EXEMPT_PREFIXES.some((p) => req.url.startsWith(p))) return;
    const header = req.headers[HEADERS.csrf];
    if (typeof header !== 'string' || !csrfCookie || !safeEqual(header, csrfCookie)) {
      return reply.code(403).send({ error: { code: 'CSRF_FAILED', requestId: String(req.id) } });
    }
  });
}
