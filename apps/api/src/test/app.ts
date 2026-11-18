import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { COOKIES, HEADERS } from '@gunraid/shared';
import { createApp } from '../bootstrap.js';
import type { Env } from '../config/env.js';
import { testEnv } from './env.js';

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
}

/** HTTP-клиент для тестов: хранит cookie (как браузер) и сам отправляет CSRF-заголовок. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  /** Каждый тестовый клиент — со своего IP (как разные игроки), чтобы не упираться в лимиты по IP. */
  ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

  constructor(private readonly app: NestFastifyApplication) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(setCookie: string | string[] | undefined): void {
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(';');
      if (!pair) continue;
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some(
        (a) => /max-age=0/i.test(a) || /expires=Thu, 01 Jan 1970/i.test(a),
      );
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse<T>> {
    if (method !== 'GET' && !this.cookies.has(COOKIES.csrf)) {
      await this.request('GET', '/api/v1/auth/csrf');
    }
    const res = await this.app.inject({
      method,
      url,
      payload: payload === undefined ? undefined : (payload as object),
      remoteAddress: this.ip,
      headers: {
        cookie: this.cookieHeader(),
        ...(method !== 'GET' ? { [HEADERS.csrf]: this.cookies.get(COOKIES.csrf) ?? '' } : {}),
        ...headers,
      },
    });
    this.absorb(res.headers['set-cookie']);
    let body: unknown = res.body;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      // не JSON
    }
    return {
      status: res.statusCode,
      body: body as T,
      headers: res.headers as Record<string, string | string[] | undefined>,
    };
  }

  get = <T = unknown>(url: string, headers?: Record<string, string>) =>
    this.request<T>('GET', url, undefined, headers);
  post = <T = unknown>(url: string, payload?: unknown, headers?: Record<string, string>) =>
    this.request<T>('POST', url, payload ?? {}, headers);
  put = <T = unknown>(url: string, payload?: unknown) => this.request<T>('PUT', url, payload ?? {});
  patch = <T = unknown>(url: string, payload?: unknown) =>
    this.request<T>('PATCH', url, payload ?? {});
  delete = <T = unknown>(url: string) => this.request<T>('DELETE', url);

  async devLogin(preset: 'player' | 'support' | 'admin' = 'player', nickname?: string) {
    const res = await this.post(
      '/api/v1/auth/dev-login',
      nickname ? { preset, nickname } : { preset },
    );
    if (res.status !== 200) throw new Error(`dev login failed: ${JSON.stringify(res.body)}`);
    return res;
  }

  /** Новый игрок с уникальным ником и подтверждёнными 18+. */
  async loginNewPlayer(prefix = 'p'): Promise<string> {
    const nickname = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
    await this.devLogin('player', nickname);
    await this.post('/api/v1/me/confirm-age', { confirm: true });
    return nickname;
  }
}

export async function createTestApp(env: Env = testEnv()): Promise<NestFastifyApplication> {
  const app = await createApp(env, { logger: false, websockets: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
