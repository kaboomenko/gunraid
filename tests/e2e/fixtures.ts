import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type {
  CaseOpenResultDto,
  DepositDto,
  DepositQuoteDto,
  HomeDto,
  InventoryPageDto,
  MeDto,
  PageDto,
  TransactionDto,
} from '@gunraid/shared';

/** Ответ API: статус и тело (ошибки не бросаем — их проверяют тесты). */
export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** Успешный ответ (200/201/204) — с телом в сообщении об ошибке. */
export function expectOk(res: ApiResponse<unknown>): void {
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(200);
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
}

/**
 * Клиент API, разделяющий cookie с браузерным контекстом: всё, что сделано через него
 * (вход, пополнение), сразу видно на страницах, и наоборот. CSRF — double-submit cookie.
 */
export class Api {
  constructor(private readonly context: BrowserContext) {}

  private async csrf(): Promise<string> {
    const find = async () =>
      (await this.context.cookies()).find((c) => c.name === 'gr_csrf')?.value ?? '';
    let token = await find();
    if (!token) {
      await this.context.request.get('/api/v1/health');
      token = await find();
    }
    return token;
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await this.context.request.get(`/api/v1${path}`);
    return { status: res.status(), body: (await res.json().catch(() => null)) as T };
  }

  async send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown,
    opts: { idempotent?: boolean } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'x-csrf-token': await this.csrf() };
    if (opts.idempotent) headers['idempotency-key'] = crypto.randomUUID();
    const res = await this.context.request.fetch(`/api/v1${path}`, {
      method,
      headers,
      data: data ?? {},
    });
    return { status: res.status(), body: (await res.json().catch(() => null)) as T };
  }

  post<T>(path: string, data?: unknown, opts?: { idempotent?: boolean }) {
    return this.send<T>('POST', path, data, opts);
  }

  /** Вход тестовым пользователем (AUTH_DEV_LOGIN=true). С nickname — новый игрок. */
  async devLogin(
    preset: 'player' | 'support' | 'admin',
    nickname?: string,
    opts: { confirmAge?: boolean } = {},
  ): Promise<MeDto> {
    const body = nickname ? { preset, nickname } : { preset };
    let res = await this.post<{ error?: { details?: { retryAfterMs?: number } } }>(
      '/auth/dev-login',
      body,
    );
    // Вход ограничен 30 в минуту с одного IP: весь набор идёт с одного адреса — ждём, как клиент.
    for (let i = 0; res.status === 429 && i < 3; i++) {
      const wait = Number(res.body?.error?.details?.retryAfterMs ?? 5000);
      await new Promise((r) => setTimeout(r, Math.min(wait, 65_000) + 250));
      res = await this.post('/auth/dev-login', body);
    }
    expect(res.status, 'dev-login включён (AUTH_DEV_LOGIN=true)').toBeLessThan(300);
    const me = await this.get<MeDto>('/me');
    if (!me.body.adultConfirmed && opts.confirmAge !== false) {
      expectOk(await this.post('/me/confirm-age', { confirm: true }));
    }
    return (await this.get<MeDto>('/me')).body;
  }

  async me(): Promise<MeDto> {
    return (await this.get<MeDto>('/me')).body;
  }

  /** Тестовое пополнение: тот же путь, что окно оплаты + страница тестового провайдера. */
  async topUp(usd: number): Promise<DepositDto> {
    const quote = await this.post<DepositQuoteDto>('/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: String(usd),
    });
    expectOk(quote);
    const dep = await this.post<DepositDto>(
      '/deposits',
      { quoteId: quote.body.quoteId },
      { idempotent: true },
    );
    expectOk(dep);
    const done = await this.post<DepositDto>(`/payments/mock/${dep.body.id}/complete`, {
      result: 'success',
    });
    expect(done.body.status, JSON.stringify(done.body)).toBe('succeeded');
    return done.body;
  }

  /** Самый дешёвый платный кейс игры без ограничений по уровню/тиражу. */
  async cheapestCase(game: string): Promise<{ id: string; slug: string; price: number }> {
    const home = await this.get<HomeDto>(`/games/${game}/home`);
    const cases = home.body.categories
      .flatMap((c) => c.cases)
      .filter((c) => c.price > 0 && !c.minLevel && !c.supplyTotal && !c.cooldownSeconds)
      .sort((a, b) => a.price - b.price);
    const c = cases[0];
    if (!c) throw new Error(`no paid case for ${game}`);
    return { id: c.id, slug: c.slug, price: c.price };
  }

  async openCase(game: string, slug: string, count = 1): Promise<CaseOpenResultDto> {
    const res = await this.post<CaseOpenResultDto>(
      `/games/${game}/cases/${slug}/open`,
      { count },
      { idempotent: true },
    );
    expectOk(res);
    return res.body;
  }

  async inventory(game: string): Promise<InventoryPageDto> {
    return (await this.get<InventoryPageDto>(`/games/${game}/inventory?pageSize=100`)).body;
  }

  /** Баланс сходится с собственными записями ledger пользователя (все страницы истории). */
  async expectLedgerConsistent(): Promise<void> {
    const me = await this.me();
    const items: TransactionDto[] = [];
    let cursor: string | null = null;
    do {
      const tx: ApiResponse<PageDto<TransactionDto>> = await this.get<PageDto<TransactionDto>>(
        `/me/transactions${cursor ? `?cursor=${cursor}` : ''}`,
      );
      expect(tx.status).toBe(200);
      items.push(...tx.body.items);
      cursor = tx.body.nextCursor;
    } while (cursor);
    const sum = items.reduce((s, t) => s + t.amount, 0);
    expect(sum, 'сумма записей ledger = баланс').toBe(me.balance);
    if (items.length) {
      const last = [...items].sort((a, b) => b.id - a.id)[0]!;
      expect(last.balanceAfter, 'balance_after последней записи = баланс').toBe(me.balance);
    }
  }
}

/** Настройки до загрузки страниц: без звука, ускоренные анимации, cookie-баннер закрыт. */
export async function quietPrefs(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'gr-prefs',
        JSON.stringify({ state: { sound: false, fast: true, cookiesAck: true }, version: 0 }),
      );
    } catch {
      // приватный режим — не критично
    }
  });
}

export const uniqueNick = (prefix = 'e2e') =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

/** Отдельная «вкладка» другого пользователя (свои cookie) — только API. */
export async function separateApi(
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ api: Api; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  return { api: new Api(context), close: () => context.close() };
}

interface Fixtures {
  api: Api;
  /** Новый игрок (вход выполнен, 18+ подтверждено, звук выключен, быстрый режим). */
  player: MeDto;
  /** Администратор в отдельном контексте (для подготовки данных и проверок). */
  adminApi: Api;
}

/** Ждём гидратацию после каждой загрузки страницы: иначе ввод может потеряться. */
async function waitHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      const type = res?.headers()['content-type'] ?? '';
      if (type.includes('text/html')) await waitHydrated(page);
      return res;
    };
    page.reload = async (options) => {
      const res = await reload(options);
      await waitHydrated(page);
      return res;
    };
    await use(page);
  },
  api: async ({ context }, use) => {
    await quietPrefs(context);
    await use(new Api(context));
  },
  player: async ({ api }, use) => {
    const me = await api.devLogin('player', uniqueNick());
    await api.send('PATCH', '/me/settings', { soundEnabled: false, fastModeDefault: true });
    await use(me);
  },
  adminApi: async ({ browser, baseURL }, use) => {
    const { api, close } = await separateApi(browser, baseURL);
    await api.devLogin('admin');
    await use(api);
    await close();
  },
});

export { expect };

/** Баланс в шапке (число без пробелов-разделителей). */
export async function headerBalance(page: Page): Promise<number> {
  const text = (await page.getByTestId('balance').innerText()).replace(/\D/g, '');
  return Number(text);
}
