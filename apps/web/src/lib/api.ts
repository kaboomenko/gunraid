import { API_PREFIX, COOKIES, HEADERS, isApiErrorBody, type ErrorCode } from '@gunraid/shared';
import { getCookie } from './cookies';

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    public readonly code: ClientErrorCode,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Внутренний флаг: не повторять запрос после refresh повторно. */
  retried?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureCsrf(): Promise<string> {
  let token = getCookie(COOKIES.csrf);
  if (!token) {
    await fetch(`${API_PREFIX}/auth/csrf`, { credentials: 'include', cache: 'no-store' });
    token = getCookie(COOKIES.csrf);
  }
  return token ?? '';
}

let refreshing: Promise<boolean> | null = null;

/** Одна попытка обновить сессию на все параллельные запросы (single-flight). */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { [HEADERS.csrf]: await ensureCsrf() },
        });
        if (res.ok) return true;
        if (res.status === 409) {
          // Другая вкладка уже обновила токены — cookie общие.
          await sleep(400);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      }
    })();
  }
  return refreshing;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers[HEADERS.csrf] = await ensureCsrf();
  if (opts.idempotencyKey) headers[HEADERS.idempotency] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('NETWORK', 0);
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // тело не JSON
  }
  const code: ClientErrorCode = isApiErrorBody(payload) ? payload.error.code : 'INTERNAL';

  if (!opts.retried) {
    if (res.status === 401 && (code === 'TOKEN_EXPIRED' || code === 'SESSION_REVOKED')) {
      if (await refreshSession()) return apiRequest<T>(method, path, body, { ...opts, retried: true });
    }
    if (code === 'CSRF_FAILED') {
      await fetch(`${API_PREFIX}/auth/csrf`, { credentials: 'include', cache: 'no-store' });
      return apiRequest<T>(method, path, body, { ...opts, retried: true });
    }
  }
  throw new ApiError(code, res.status, isApiErrorBody(payload) ? payload.error.details : undefined);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiRequest<T>('GET', path, undefined, opts),
  post: <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    apiRequest<T>('POST', path, body, opts),
  put: <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    apiRequest<T>('PUT', path, body, opts),
  patch: <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    apiRequest<T>('PATCH', path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => apiRequest<T>('DELETE', path, undefined, opts),
};

/** Уникальный ключ идемпотентности на одно действие пользователя. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
