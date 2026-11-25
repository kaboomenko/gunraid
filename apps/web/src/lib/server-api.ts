import type { PublicConfigDto } from '@gunraid/shared';

/** Запросы к API с сервера Next (SSR). Только публичные данные — без cookie пользователя. */
const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export class ServerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API ${status} ${path}`);
  }
}

export async function serverGet<T>(
  path: string,
  options: { revalidate?: number | false; tags?: string[] } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    next: { revalidate: options.revalidate ?? 30, tags: options.tags },
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new ServerApiError(res.status, path);
  return (await res.json()) as T;
}

export async function serverGetOrNull<T>(
  path: string,
  options?: { revalidate?: number | false; tags?: string[] },
): Promise<T | null> {
  try {
    return await serverGet<T>(path, options);
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 404) return null;
    throw err;
  }
}

const FALLBACK_CONFIG: PublicConfigDto = {
  gemsPerUsd: 100,
  defaultGame: 'standoff2',
  games: [],
  supportTelegramUrl: null,
  auth: { steam: false, google: false, telegram: null, dev: false },
  promoStrip: null,
  firstDepositPercent: 0,
};

export async function getPublicConfig(): Promise<PublicConfigDto> {
  try {
    return await serverGet<PublicConfigDto>('/config', { revalidate: 15 });
  } catch {
    return FALLBACK_CONFIG;
  }
}

/**
 * Роль текущего пользователя для серверной проверки доступа (админка): пробрасываем cookie access-токена.
 * null — токена нет или он истёк (решит клиент после обновления сессии).
 */
export async function serverMeRole(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/me`, {
      headers: { accept: 'application/json', cookie: `gr_at=${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { role?: string };
    return me.role ?? null;
  } catch {
    return null;
  }
}
