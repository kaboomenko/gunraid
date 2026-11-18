import { COOKIES } from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
}

export function getRequestMeta(req: FastifyRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  const deviceId = req.cookies?.[COOKIES.device];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    deviceId: deviceId && /^[A-Za-z0-9_-]{16,64}$/.test(deviceId) ? deviceId : null,
  };
}
