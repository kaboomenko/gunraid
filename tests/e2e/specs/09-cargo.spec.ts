import type {
  AdminAuditRowDto,
  AdminCargoBody,
  AdminCargoDetailDto,
  AdminCargoRowDto,
  AdminItemDto,
  AdminPageDto,
  CargoBuyResultDto,
  CargoCardDto,
  CargoListDto,
  MeDto,
} from '@gunraid/shared';
import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import {
  expect,
  expectOk,
  headerBalance,
  quietPrefs,
  separateApi,
  test,
  uniqueNick,
  type Api,
} from '../fixtures';

/**
 * Ивентовые грузы. Покупки — только в своих тестовых грузах: БД стенда живёт между прогонами, и места в сидовом
 * раунде копились бы до распродажи. Тестовые грузы создаёт админ через API (slug `e2e-…`, в конце списка);
 * afterAll выключает их, отменяет открытые раунды с возвратом гемов и отправляет в архив — в том числе грузы
 * прерванного прогона.
 */
const GAME = 'standoff2';
const PREFIX = 'e2e-';

/** Числа мест и гемов — как на сайте (formatGems): до четырёх знаков слитно, от пяти — с разделителями. */
const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0, useGrouping: 'min2' }).format(n);

/** Шанс на карточке приза: (мест + выбрано) / N, в процентах, как formatChance у карточки. */
function chance(seats: number, total: number): string {
  const n = (seats / total) * 100;
  return `${n >= 0.01 ? n.toFixed(2) : String(Number(n.toPrecision(2)))}%`;
}

/** Client seed покупки (обязателен, D5): 32 hex-символа, как у сайта. */
const clientSeed = () => crypto.randomUUID().replace(/-/g, '');

/**
 * Грузы игры с открытым раундом (как у страницы и стрелок). На только что поднятом стеке раунды сидов открывает
 * тикер воркера через несколько секунд после старта — ждём, пока грузов не станет хотя бы min.
 */
async function cargoList(api: Api, min = 1): Promise<CargoCardDto[]> {
  let items: CargoCardDto[] = [];
  await expect
    .poll(
      async () => {
        const res = await api.get<CargoListDto>(`/games/${GAME}/cargo`);
        items = res.status === 200 ? res.body.items : [];
        return items.length;
      },
      { timeout: 30_000, message: 'грузы с открытым раундом' },
    )
    .toBeGreaterThanOrEqual(min);
  return items;
}

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`не дождались за ${ms} мс: ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Админ и тестовые грузы ----------

/** Один вход админа на воркер (вход ограничен 30 в минуту с IP); после падения теста воркер — новый. */
let admin: { api: Api; close: () => Promise<void> } | null = null;
let prize: AdminItemDto | null = null;
/** id грузов, созданных в этом воркере (afterAll убирает их и прочие `e2e-…`). */
const created = new Set<string>();
let seq = 0;

async function adminApi(browser: Browser, baseURL: string | undefined): Promise<Api> {
  if (!admin) {
    const s = await separateApi(browser, baseURL);
    await s.api.devLogin('admin');
    admin = s;
  }
  return admin.api;
}

/** Самый дешёвый активный предмет игры: админка отдаёт по убыванию цены — он в конце последней страницы. */
async function cheapestPrize(adm: Api): Promise<AdminItemDto> {
  if (prize) return prize;
  const url = (page: number) => `/admin/games/${GAME}/items?active=1&pageSize=100&page=${page}`;
  const first = await adm.get<AdminPageDto<AdminItemDto>>(url(1));
  expectOk(first);
  const pages = Math.max(1, Math.ceil(first.body.total / 100));
  const last = pages > 1 ? await adm.get<AdminPageDto<AdminItemDto>>(url(pages)) : first;
  expectOk(last);
  prize = last.body.items.reduce((a, b) => (b.price < a.price ? b : a));
  return prize;
}

const nextSlug = () => `${PREFIX}${Date.now().toString(36)}-${++seq}`;

interface TestCargo {
  id: string;
  slug: string;
  name: string;
  roundId: string;
  seatsTotal: number;
  seatPrice: number;
  url: string;
}

/** Свой груз: активный — раунд №1 открыт сразу; в конце списка (порядок 99 999), приз — самый дешёвый. */
async function createCargo(
  adm: Api,
  { seats, price = 10 }: { seats: number; price?: number },
): Promise<TestCargo> {
  const p = await cheapestPrize(adm);
  const slug = nextSlug();
  const body: AdminCargoBody = {
    slug,
    name: `E2E груз ${slug.slice(PREFIX.length)}`,
    imageUrl: '/media/cargo/light.webp',
    prizeItemId: p.id,
    seatsTotal: seats,
    seatPrice: price,
    perUserLimit: null,
    durationMinutes: 600,
    minLevel: null,
    depositWithinDays: null,
    minSeatsToLand: null,
    isActive: true,
    sortOrder: 99_999,
  };
  const res = await adm.post<AdminCargoDetailDto>(`/admin/games/${GAME}/cargo`, body);
  expectOk(res);
  created.add(res.body.id);
  expect(res.body.round?.number, 'у активного груза сразу открыт раунд №1').toBe(1);
  return {
    id: res.body.id,
    slug,
    name: body.name,
    roundId: res.body.round!.id,
    seatsTotal: seats,
    seatPrice: price,
    url: `/${GAME}/cargo/${slug}`,
  };
}

/** Тело PUT из детальной: схема строгая — только поля шаблона. */
function bodyOf(d: AdminCargoDetailDto, patch: Partial<AdminCargoBody> = {}): AdminCargoBody {
  return {
    slug: d.slug,
    name: d.name,
    imageUrl: d.imageUrl,
    prizeItemId: d.prize.id,
    seatsTotal: d.seatsTotal,
    seatPrice: d.seatPrice,
    perUserLimit: d.perUserLimit,
    durationMinutes: d.durationMinutes,
    minLevel: d.minLevel,
    depositWithinDays: d.depositWithinDays,
    minSeatsToLand: d.minSeatsToLand,
    isActive: d.isActive,
    sortOrder: d.sortOrder,
    ...patch,
  };
}

/**
 * Убрать груз: выключить (иначе отмена сразу откроет следующий раунд), отменить открытый раунд с возвратом
 * гемов, отправить в архив. Повтор — если между шагами раунд сменился (приземлился, открылся).
 */
async function retire(adm: Api, id: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const got = await adm.get<AdminCargoDetailDto>(`/admin/cargo/${id}`);
    expectOk(got);
    let d = got.body;
    if (d.archivedAt) return;
    if (d.isActive) {
      const off = await adm.send<AdminCargoDetailDto>(
        'PUT',
        `/admin/games/${d.game}/cargo/${id}`,
        bodyOf(d, { isActive: false }),
      );
      expectOk(off);
      d = off.body;
    }
    if (d.round?.status === 'open') {
      await adm.post(`/admin/cargo-rounds/${d.round.id}/cancel`, {
        reason: 'e2e: уборка тестового груза',
      });
    }
    const del = await adm.send<AdminCargoDetailDto>('DELETE', `/admin/cargo/${id}`);
    if (del.status === 200 && del.body.archivedAt) return;
  }
  throw new Error(`тестовый груз ${id} не ушёл в архив`);
}

test.afterAll(async ({ browser }, testInfo) => {
  const adm = await adminApi(browser, testInfo.project.use.baseURL);
  // Кроме своих — грузы `e2e-…`, оставшиеся от прерванного прогона: после спека висящих тестовых грузов нет.
  const list = await adm.get<AdminCargoRowDto[]>(`/admin/games/${GAME}/cargo`);
  expectOk(list);
  const ids = new Set([
    ...created,
    ...list.body.filter((c) => c.slug.startsWith(PREFIX)).map((c) => c.id),
  ]);
  for (const id of ids) await retire(adm, id);
  created.clear();
  await admin?.close();
  admin = null;
});

// ---------- Игроки, страницы, сокет ----------

interface Other {
  api: Api;
  me: MeDto;
  close: () => Promise<void>;
}

/** Второй игрок (свои cookie) — только API; с тестовым пополнением. */
async function otherPlayer(
  browser: Browser,
  baseURL: string | undefined,
  prefix: string,
): Promise<Other> {
  const s = await separateApi(browser, baseURL);
  const me = await s.api.devLogin('player', uniqueNick(prefix));
  await s.api.topUp(1);
  return { ...s, me };
}

async function buyVia(api: Api, cargo: TestCargo, count: number): Promise<CargoBuyResultDto> {
  const res = await api.post<CargoBuyResultDto>(
    `/games/${GAME}/cargo/${cargo.slug}/buy`,
    { roundId: cargo.roundId, count, clientSeed: clientSeed() },
    { idempotent: true },
  );
  expectOk(res);
  return res.body;
}

/** Страница в своём контексте (новая вкладка, зритель): переход и ожидание гидратации, как у фикстуры page. */
async function openPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
  return page;
}

/**
 * Страница подписалась на комнату грузов игры: кадр socket.io «subscribe» ушёл на сервер. Слушатель — до
 * page.goto: событие чужой покупки, отправленное раньше подписки, страница не получила бы.
 */
function cargoRoomJoined(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (ws) =>
      ws.on('framesent', ({ payload }) => {
        if (String(payload).includes(`"subscribe","cargo:${GAME}"`)) resolve();
      }),
    );
  });
}

/** До страницы дошло событие итога раунда (cargo:result). Слушатель — до page.goto. */
function cargoResultReceived(page: Page, roundId: string): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (ws) =>
      ws.on('framereceived', ({ payload }) => {
        const s = String(payload);
        if (s.includes('"cargo:result"') && s.includes(roundId)) resolve();
      }),
    );
  });
}

/**
 * Журнал сцены: фаза, открыто ли окно итога, строка под кнопкой — каждое изменение. По нему видно, что было
 * за всё время (фаза landing при «уменьшить движение», строка зрителя у участника), а не только в конце.
 */
async function recordStage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __cargo: string[] };
    w.__cargo = [];
    let last = '';
    const snap = () => {
      const phase = document.querySelector('.cargo-stage__inner')?.getAttribute('data-phase');
      const modal = document.querySelector('[data-testid="cargo-result"]') ? 'modal' : '-';
      const info = document.querySelector('[data-testid="cargo-info"]')?.textContent ?? '';
      const s = `${phase}|${modal}|${info}`;
      if (s !== last) w.__cargo.push((last = s));
    };
    new MutationObserver(snap).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    snap();
  });
}

const stageLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cargo: string[] }).__cargo);

/** Строка зрителя (D31) — «Груз приземлился: победил …»; участнику её быть не должно. */
const SPECTATOR_NOTE = 'Груз приземлился:';

async function expectLandedProof(
  page: Page,
  roundId: string,
  winner: { nickname: string },
  seat: number,
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/provably-fair\\?cargo=${roundId}$`));
  await expect(page.getByTestId('cargo-proof')).toHaveAttribute('data-outcome', 'landed');
  // Хэш server seed, места подряд, client seed раунда из покупок и место — всё пересчитано в браузере.
  for (const id of [
    'cargo-proof-hash',
    'cargo-proof-seats',
    'cargo-proof-client',
    'cargo-proof-seat',
  ]) {
    await expect(page.getByTestId(id), id).toHaveAttribute('data-ok', 'true');
  }
  await expect(page.getByTestId('cargo-proof-seat-value')).toHaveText(`№${seat}`);
  await expect(page.getByTestId('cargo-proof-winner')).toHaveText(`Победитель: ${winner.nickname}`);
  await expect(page.locator('[data-testid="cargo-proof-row"][data-mark="winner"]')).toHaveCount(1);
}

test.describe('Страница груза', () => {
  test('/standoff2/cargo — первый груз: таймер, шанс на карточке приза, кнопка и «Доступно мест»', async ({
    page,
    api,
  }) => {
    const list = await cargoList(api);
    const first = list[0]!;
    await page.goto(`/${GAME}/cargo`);
    await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${first.slug}$`));
    await expect(page.getByTestId('cargo-title')).toHaveText(first.name);
    await expect(page.getByText('Упадёт через')).toBeVisible();
    for (const unit of ['hours', 'minutes', 'seconds']) {
      await expect(page.getByTestId(`cargo-timer-${unit}`)).toHaveText(/^\d{2,}$/);
    }
    await expect(page.getByTestId('cargo-timer').locator('.cargo-timer__unit')).toHaveText([
      'час',
      'мин',
      'сек',
    ]);

    // Шанс и сумма — у платного груза, где можно взять два места (у сидового «Лёгкого»: 100 мест → 1.00%).
    const c = list.find((x) => !x.isFree && x.seatsTotal - x.seatsSold >= 2);
    expect(c, 'в списке есть платный груз со свободными местами').toBeTruthy();
    if (c!.slug !== first.slug) await page.goto(`/${GAME}/cargo/${c!.slug}`);
    const card = page.getByTestId('cargo-prize');
    await expect(card.getByTestId('skin-card-chance')).toHaveText(chance(1, c!.seatsTotal));
    await expect(page.getByTestId('cargo-available')).toHaveText(
      `Доступно мест ${fmt(c!.seatsTotal - c!.seatsSold)}/${fmt(c!.seatsTotal)}`,
    );
    await expect(page.getByTestId('cargo-buy-login')).toHaveText(
      `Купить место за ${fmt(c!.seatPrice)}`,
    );
    await page.getByTestId('cargo-qty-plus').click();
    await expect(page.getByTestId('cargo-qty')).toHaveValue('2');
    await expect(card.getByTestId('skin-card-chance')).toHaveText(chance(2, c!.seatsTotal));
    await expect(page.getByTestId('cargo-buy-login')).toHaveText(
      `Купить места за ${fmt(2 * c!.seatPrice)}`,
    );
  });

  test('стрелки: соседний груз без прокрутки, по кругу; Enter оставляет фокус на стрелке', async ({
    page,
    api,
  }) => {
    const list = await cargoList(api, 2);
    const first = list[0]!;
    const last = list[list.length - 1]!;
    // Соседей страница строит по списку грузов из кэша Next (до 15 с): сразу после создания или архива груза
    // (уборка прошлого прогона) стрелки бывают устаревшими — ждём, пока страница не сойдётся со списком API.
    await expect
      .poll(
        async () => {
          await page.goto(`/${GAME}/cargo/${first.slug}`);
          return page.getByTestId('cargo-arrow-prev').getAttribute('href');
        },
        { timeout: 45_000, intervals: [2_000] },
      )
      .toBe(`/${GAME}/cargo/${last.slug}`);

    // Стрелка — посреди экрана: страница прокручена, и переход не должен вернуть её наверх.
    await page
      .getByTestId('cargo-arrow-next')
      .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const y0 = await page.evaluate(() => window.scrollY);
    for (let i = 1; i <= list.length; i++) {
      const want = list[i % list.length]!;
      await page.getByTestId('cargo-arrow-next').click();
      await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${want.slug}$`));
      await expect(page.getByTestId('cargo-title')).toHaveText(want.name);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(1);
    }
    // Слева от первого — последний.
    await page.getByTestId('cargo-arrow-prev').click();
    await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${last.slug}$`));
    await expect(page.getByTestId('cargo-title')).toHaveText(last.name);

    // С клавиатуры: Enter — переход, фокус на той же стрелке нового груза (можно листать дальше).
    await page.getByTestId('cargo-arrow-next').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${first.slug}$`));
    await expect(page.getByTestId('cargo-arrow-next')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${list[1]!.slug}$`));
    await expect(page.getByTestId('cargo-arrow-next')).toBeFocused();
  });

  test('гость: «Купить» открывает вход, после окна фокус снова на кнопке', async ({
    page,
    api,
  }) => {
    const first = (await cargoList(api))[0]!;
    await page.goto(`/${GAME}/cargo/${first.slug}`);
    const buy = page.getByTestId('cargo-buy-login');
    await buy.click();
    await expect(page.getByTestId('login-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('login-modal')).toHaveCount(0);
    await expect(buy).toBeFocused();
  });

  test('не хватает гемов: красная кнопка, «Недостаточно средств», окно пополнения', async ({
    page,
    api,
    player,
  }) => {
    expect(player.balance).toBe(0);
    const paid = (await cargoList(api)).find((c) => !c.isFree)!;
    await page.goto(`/${GAME}/cargo/${paid.slug}`);
    const buy = page.getByTestId('cargo-buy');
    await expect(buy).toHaveAttribute('data-state', 'insufficient');
    const info = page.getByTestId('cargo-info');
    await expect(info).toHaveText('Недостаточно средств');
    await expect(info).toHaveAttribute('data-tone', 'error');
    await buy.click();
    await expect(page.getByTestId('deposit-pay')).toBeVisible();
    // Мест не купили, гемы не списаны.
    expect((await api.me()).balance).toBe(0);
  });

  test('покупка трёх мест: toast, «Доступно мест», баланс, «Ваши места» и проверка раунда', async ({
    page,
    api,
    player,
    browser,
    baseURL,
  }) => {
    expect(player.id).toBeTruthy();
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 1000, price: 10 });
    await api.topUp(1);
    await page.goto(cargo.url);
    const buy = page.getByTestId('cargo-buy');
    await expect(buy).toHaveAttribute('data-state', 'ready');
    const before = await headerBalance(page);
    expect(before).toBe((await api.me()).balance);

    await page.getByTestId('cargo-qty-plus').click();
    await page.getByTestId('cargo-qty-plus').click();
    await expect(page.getByTestId('cargo-qty')).toHaveValue('3');
    await expect(page.getByTestId('cargo-prize').getByTestId('skin-card-chance')).toHaveText(
      chance(3, 1000),
    );
    await expect(buy).toHaveText(`Купить места за ${fmt(3 * cargo.seatPrice)}`);
    const response = page.waitForResponse(
      (r) => r.url().endsWith(`/cargo/${cargo.slug}/buy`) && r.request().method() === 'POST',
    );
    await buy.click();
    const res = (await (await response).json()) as CargoBuyResultDto;
    expect(res).toMatchObject({
      roundId: cargo.roundId,
      seatFrom: 1,
      seatTo: 3,
      count: 3,
      paid: 30,
    });

    await expect(page.getByText('Места №1–3 ваши', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cargo-available')).toHaveText('Доступно мест 997/1000');
    await expect.poll(() => headerBalance(page)).toBe(before - 3 * cargo.seatPrice);
    await expect(page.getByTestId('cargo-info')).toHaveText('Ваши места №1–3 Проверить');
    const verify = page.getByTestId('cargo-info-verify');
    await expect(verify).toHaveAttribute('href', `/provably-fair?cargo=${cargo.roundId}`);

    // Раунд идёт: на проверке commit из ответа покупки и своя покупка с тем же client seed (D5).
    await verify.click();
    await expect(page).toHaveURL(new RegExp(`/provably-fair\\?cargo=${cargo.roundId}$`));
    await expect(page.getByTestId('cargo-proof')).toHaveAttribute('data-outcome', 'open');
    await expect(page.getByTestId('cargo-proof-status')).toHaveText(
      'Раунд ещё идёт — server seed раскроется, когда раунд закончится',
    );
    await expect(page.getByTestId('cargo-proof-commit')).toHaveText(res.serverSeedHash);
    const mine = page.locator('[data-testid="cargo-proof-row"][data-mine]');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('№1–3');
    await expect(mine).toContainText(res.clientSeed);
    await expect(mine).toContainText('ваша покупка');
    await api.expectLedgerConsistent();
  });

  test('распродажа: окно итога участнику, строка зрителю, новый раунд, проверка раунда', async ({
    page,
    api,
    player,
    browser,
    baseURL,
  }) => {
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 2 });
    await api.topUp(1);
    const joined = cargoRoomJoined(page);
    await page.goto(cargo.url);
    await recordStage(page);
    const b = await otherPlayer(browser, baseURL, 'cargoB');
    // Зритель — гость на второй странице.
    const viewerCtx = await browser.newContext({ baseURL });
    try {
      await quietPrefs(viewerCtx);
      const viewerPage = await viewerCtx.newPage();
      const viewerJoined = cargoRoomJoined(viewerPage);
      await viewerPage.goto(cargo.url);
      await viewerPage.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
      await within(viewerJoined, 15_000, 'зритель подписан на комнату грузов');

      const buy = page.getByTestId('cargo-buy');
      await expect(buy).toHaveAttribute('data-state', 'ready');
      await buy.click();
      await expect(page.getByTestId('cargo-info')).toHaveText('Ваше место №1 Проверить');
      // Зритель видит чужую покупку по сокету; держит фокус на «+» — итог раунда его не сдвинет.
      await expect(viewerPage.getByTestId('cargo-available')).toHaveText('Доступно мест 1/2');
      await viewerPage.getByTestId('cargo-qty-plus').focus();
      await within(joined, 15_000, 'участник подписан на комнату грузов');

      // Последнее место — другой игрок через API: груз приземляется в той же транзакции.
      const last = await buyVia(b.api, cargo, 1);
      expect(last.result?.status).toBe('landed');
      const winner = last.result!.winner!;
      const seat = last.result!.winningSeat!;

      // Зритель (D31): без окна и без переноса фокуса — строка под кнопкой со ссылкой на проверку (10 с).
      await expect(viewerPage.getByTestId('cargo-info')).toHaveText(
        `Груз приземлился: победил ${winner.nickname}, место №${seat} из 2. Проверить`,
      );
      await expect(viewerPage.getByTestId('cargo-info-verify')).toHaveAttribute(
        'href',
        `/provably-fair?cargo=${cargo.roundId}`,
      );
      await expect(viewerPage.getByTestId('cargo-result')).toHaveCount(0);
      await expect(viewerPage.getByTestId('cargo-qty-plus')).toBeFocused();

      // Участник: окно итога.
      const modal = page.getByTestId('cargo-result');
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('cargo-result-winner')).toContainText(
        `Победитель: ${winner.nickname}`,
      );
      await expect(page.getByTestId('cargo-result-seat')).toHaveText(
        `Выигравшее место: №${seat} из 2`,
      );
      await expect(modal).toContainText(
        winner.shortId === player.shortId
          ? 'Это вы! Предмет уже в инвентаре'
          : 'В этот раз не повезло — следующий раунд уже начался',
      );
      const verify = page.getByTestId('cargo-result-verify');
      await expect(verify).toHaveAttribute('href', `/provably-fair?cargo=${cargo.roundId}`);
      const proofHref = (await verify.getAttribute('href'))!;
      expect((await stageLog(page)).some((s) => s.split('|')[2]!.startsWith(SPECTATOR_NOTE))).toBe(
        false,
      );

      // Окно закрыто — следующий раунд, фокус на кнопке покупки.
      await page.getByTestId('cargo-result-close').click();
      await expect(modal).toHaveCount(0);
      await expect(page.getByTestId('cargo-available')).toHaveText('Доступно мест 2/2');
      await expect(buy).toBeFocused();

      // «Проверить честность» из окна: раунд приземлился, все проверки сошлись, своя покупка подсвечена.
      await page.goto(proofHref);
      await expectLandedProof(page, cargo.roundId, winner, seat);
      await expect(page.locator('[data-testid="cargo-proof-row"][data-mine]')).toContainText('№1');
      await api.expectLedgerConsistent();
      await b.api.expectLedgerConsistent();
    } finally {
      await viewerCtx.close();
      await b.close();
    }
  });

  test('«уменьшить движение»: окно итога сразу, без посадки груза; ссылка на проверку', async ({
    page,
    api,
    player,
    browser,
    baseURL,
  }) => {
    expect(player.id).toBeTruthy();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 2 });
    await api.topUp(1);
    const joined = cargoRoomJoined(page);
    await page.goto(cargo.url);
    await recordStage(page);
    const b = await otherPlayer(browser, baseURL, 'cargoB');
    try {
      const buy = page.getByTestId('cargo-buy');
      await expect(buy).toHaveAttribute('data-state', 'ready');
      await buy.click();
      await expect(page.getByTestId('cargo-info')).toHaveText('Ваше место №1 Проверить');
      await within(joined, 15_000, 'участник подписан на комнату грузов');

      const last = await buyVia(b.api, cargo, 1);
      expect(last.result?.status).toBe('landed');
      // Обычно окно — через 1,2 с посадки груза; без анимации — как только пришёл итог.
      await expect(page.getByTestId('cargo-result')).toBeVisible({ timeout: 3_000 });
      const log = await stageLog(page);
      expect(
        log.some((s) => s.startsWith('landing|')),
        log.join('\n'),
      ).toBe(false);
      await expect(page.getByTestId('cargo-result-seat')).toHaveText(
        `Выигравшее место: №${last.result!.winningSeat} из 2`,
      );

      await page.getByTestId('cargo-result-verify').click();
      await expectLandedProof(page, cargo.roundId, last.result!.winner!, last.result!.winningSeat!);
    } finally {
      await b.close();
    }
  });

  test('телефон: без горизонтальной прокрутки, плашки и кнопка видны, блоки под кнопкой @mobile', async ({
    page,
    api,
    isMobile,
  }) => {
    const paid = (await cargoList(api)).find((c) => !c.isFree)!;
    await page.goto(`/${GAME}/cargo/${paid.slug}`);
    await expect(page.getByTestId('cargo-title')).toHaveText(paid.name);
    // С isMobile Chromium растягивает clientWidth под переполнение — берём заданную ширину окна.
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const buy = page.getByTestId('cargo-buy-login');
    for (const el of [
      page.getByTestId('cargo-price'),
      page.getByTestId('cargo-qty'),
      page.getByTestId('cargo-available'),
      buy,
    ]) {
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    // Раскладка телефона: «Как это работает?» и «Супер-приз» — под кнопкой (на десктопе — сбоку от груза).
    if (isMobile) {
      const b = (await buy.boundingBox())!;
      for (const id of ['cargo-how', 'cargo-prize-block']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.y, id).toBeGreaterThanOrEqual(b.y + b.height);
      }
      // Шкала телефона, как у страницы кейса: название ExtraBold Italic 16 в 48 под шапкой, в 6 под ним —
      // «Упадёт через» DemiBold Italic 12, таймер — в 12 под ним.
      const head = await page.evaluate(() => {
        const box = (el: Element | null) => el!.getBoundingClientRect();
        const font = (el: Element | null) => {
          const s = getComputedStyle(el!);
          return `${s.fontSize}/${s.fontWeight}/${s.fontStyle}/${s.textTransform}`;
        };
        const headers = [...document.querySelectorAll('header')].filter(
          (h) => h.getClientRects().length,
        );
        const title = document.querySelector('[data-testid="cargo-title"]');
        const sub = document.querySelector('.cargo-subtitle');
        return {
          title: font(title),
          sub: font(sub),
          header: box(title).top - box(headers[headers.length - 1]!).bottom,
          sub6: box(sub).top - box(title).bottom,
          timer12: box(document.querySelector('[data-testid="cargo-timer"]')).top - box(sub).bottom,
        };
      });
      expect(head.title).toBe('16px/800/italic/uppercase');
      expect(head.sub).toBe('12px/600/italic/uppercase');
      expect(head.header).toBeCloseTo(48, 0);
      expect(head.sub6).toBeCloseTo(6, 0);
      expect(head.timer12).toBeCloseTo(12, 0);
      // Мобильный стандарт (< 768): кнопка 36 во всю ширину контента (не шире 470), плашки 24,
      // стрелки 24×24 в полях 12.
      expect(b.height).toBeCloseTo(36, 0);
      expect(b.width).toBeCloseTo(Math.min(width - 24, 470), 0);
      for (const id of ['cargo-price', 'cargo-qty'])
        expect((await page.getByTestId(id).boundingBox())!.height, id).toBeCloseTo(24, 0);
      // Поле количества — шрифт не меньше 16 (видно 12, scale 0.75): иначе iOS увеличивает страницу
      // при фокусе.
      expect(
        await page
          .getByTestId('cargo-qty')
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      for (const id of ['cargo-arrow-prev', 'cargo-arrow-next']) {
        const a = (await page.getByTestId(id).boundingBox())!;
        expect(a.width, id).toBeCloseTo(24, 0);
        expect(a.x, id).toBeGreaterThanOrEqual(11.5);
        expect(a.x + a.width, id).toBeLessThanOrEqual(width - 11.5);
      }
      // Приз — карточка содержимого кейса 108×72 (skin-card--m), с текстами, а не «плитка».
      const card = page.getByTestId('cargo-prize');
      const c = (await card.boundingBox())!;
      expect(c.width).toBeCloseTo(108, 0);
      expect(c.height).toBeCloseTo(72, 0);
      await expect(card.getByTestId('skin-card-skin')).toBeVisible();
    }
  });

  test('чужая распродажа во время своей покупки: окно участника, а не строка зрителя', async ({
    page,
    api,
    player,
    browser,
    baseURL,
  }) => {
    expect(player.id).toBeTruthy();
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 3 });
    await api.topUp(1);
    // Ответ покупки придержан: покупка уже прошла на сервере, а страница о своих местах ещё не знает.
    let committed!: (status: number) => void;
    const purchased = new Promise<number>((r) => (committed = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v1/games/${GAME}/cargo/${cargo.slug}/buy`, async (route) => {
      const response = await route.fetch();
      committed(response.status());
      await gate;
      await route.fulfill({ response });
    });
    const joined = cargoRoomJoined(page);
    const resultArrived = cargoResultReceived(page, cargo.roundId);
    await page.goto(cargo.url);
    await recordStage(page);
    const b = await otherPlayer(browser, baseURL, 'cargoB');
    try {
      const buy = page.getByTestId('cargo-buy');
      await expect(buy).toHaveAttribute('data-state', 'ready');
      await within(joined, 15_000, 'участник подписан на комнату грузов');
      await buy.click();
      expect(await within(purchased, 15_000, 'покупка прошла на сервере')).toBe(200);

      // Пока ответ «в пути», другой игрок выкупает остаток — итог раунда приходит по сокету раньше ответа.
      const last = await buyVia(b.api, cargo, cargo.seatsTotal - 1);
      expect(last.result?.status).toBe('landed');
      await within(resultArrived, 15_000, 'cargo:result дошёл до страницы');
      release();

      await expect(page.getByText('Место №1 ваше', { exact: true })).toBeVisible();
      await expect(page.getByTestId('cargo-result')).toBeVisible();
      await expect(page.getByTestId('cargo-result-seat')).toHaveText(
        `Выигравшее место: №${last.result!.winningSeat} из 3`,
      );
      const log = await stageLog(page);
      expect(
        log.some((s) => s.split('|')[2]!.startsWith(SPECTATOR_NOTE)),
        log.join('\n'),
      ).toBe(false);
      await api.expectLedgerConsistent();
    } finally {
      release();
      await b.close();
    }
  });

  test('обрыв сокета при распродаже: после переподключения — окно итога участнику', async ({
    page,
    api,
    player,
    browser,
    baseURL,
  }) => {
    expect(player.id).toBeTruthy();
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 3 });
    await api.topUp(1);
    // Сокет страницы — через прокси Playwright: его можно оборвать и не пускать обратно, пока «нет сети».
    let offline = false;
    let joins = 0;
    /** Итоги этого раунда, дошедшие по сокету: должно быть 0 — окно строится по данным груза. */
    let results = 0;
    const links: Array<{ ws: WebSocketRoute; server: WebSocketRoute }> = [];
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (offline) {
        void ws.close({ code: 4001, reason: 'offline' });
        return;
      }
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        server.send(message);
        if (String(message).includes(`"subscribe","cargo:${GAME}"`)) joins++;
      });
      server.onMessage((message) => {
        const s = String(message);
        if (s.includes('"cargo:result"') && s.includes(cargo.roundId)) results++;
        ws.send(message);
      });
      links.push({ ws, server });
    });
    await page.route(/\/socket\.io\/.*transport=polling/, (route) =>
      offline ? route.abort() : route.continue(),
    );
    await page.goto(cargo.url);
    await recordStage(page);
    const b = await otherPlayer(browser, baseURL, 'cargoB');
    try {
      const buy = page.getByTestId('cargo-buy');
      await expect(buy).toHaveAttribute('data-state', 'ready');
      await buy.click();
      await expect(page.getByTestId('cargo-info')).toHaveText('Ваше место №1 Проверить');
      await expect.poll(() => joins).toBeGreaterThan(0);

      // Сеть пропала: сокет оборван, переподключиться нельзя; тем временем раунд распродают.
      offline = true;
      for (const l of links.splice(0)) {
        await l.ws.close({ code: 4000, reason: 'drop' });
        await l.server.close();
      }
      const joinsBefore = joins;
      const last = await buyVia(b.api, cargo, cargo.seatsTotal - 1);
      expect(last.result?.status).toBe('landed');
      await expect(page.getByTestId('cargo-result')).toHaveCount(0);

      // Сеть вернулась: сокет переподключился (подписка заново), итог — из данных груза (пропущенный).
      offline = false;
      await expect.poll(() => joins, { timeout: 30_000 }).toBeGreaterThan(joinsBefore);
      await expect(page.getByTestId('cargo-result')).toBeVisible();
      await expect(page.getByTestId('cargo-result-seat')).toHaveText(
        `Выигравшее место: №${last.result!.winningSeat} из 3`,
      );
      expect(results, 'итог раунда по сокету не приходил').toBe(0);
      const log = await stageLog(page);
      expect(
        log.some((s) => s.split('|')[2]!.startsWith(SPECTATOR_NOTE)),
        log.join('\n'),
      ).toBe(false);
    } finally {
      offline = false;
      await b.close();
    }
  });

  test('места куплены в другой вкладке: при приземлении у первой вкладки окно участника', async ({
    page,
    context,
    api,
    player,
    browser,
    baseURL,
  }) => {
    expect(player.id).toBeTruthy();
    const cargo = await createCargo(await adminApi(browser, baseURL), { seats: 3 });
    await api.topUp(1);
    const joined = cargoRoomJoined(page);
    await page.goto(cargo.url);
    await recordStage(page);
    const b = await otherPlayer(browser, baseURL, 'cargoB');
    try {
      await within(joined, 15_000, 'первая вкладка подписана на комнату грузов');
      // Вторая вкладка того же игрока (те же cookie) — покупает место сама.
      const second = await openPage(context, cargo.url);
      const buy2 = second.getByTestId('cargo-buy');
      await expect(buy2).toHaveAttribute('data-state', 'ready');
      await buy2.click();
      await expect(second.getByTestId('cargo-info')).toHaveText('Ваше место №1 Проверить');
      // Первая вкладка видит продажу по сокету, но чьё это место — не знает (cargo:seats без владельцев).
      await expect(page.getByTestId('cargo-available')).toHaveText('Доступно мест 2/3');
      await expect(page.getByTestId('cargo-info')).not.toContainText('Ваш');

      const last = await buyVia(b.api, cargo, cargo.seatsTotal - 1);
      expect(last.result?.status).toBe('landed');
      // Свои места в раунде первая вкладка узнаёт из данных груза (lastResultMySeats) — окно участника.
      await expect(page.getByTestId('cargo-result')).toBeVisible();
      await expect(page.getByTestId('cargo-result-seat')).toHaveText(
        `Выигравшее место: №${last.result!.winningSeat} из 3`,
      );
      await expect(second.getByTestId('cargo-result')).toBeVisible();
      const log = await stageLog(page);
      // Ни строки зрителя, ни «Ваше место» до итога: участие решили данные груза, а не места этой вкладки.
      expect(
        log.some((s) => s.split('|')[2]!.startsWith(SPECTATOR_NOTE)),
        log.join('\n'),
      ).toBe(false);
      expect(
        log.some((s) => s.split('|')[2]!.includes('Ваш')),
        log.join('\n'),
      ).toBe(false);
    } finally {
      await b.close();
    }
  });
});

test.describe('Грузы в админке', () => {
  test('список с сидовыми грузами; новый груз через форму — сразу раунд №1, «В архив» закрыт', async ({
    page,
    api,
    browser,
    baseURL,
  }) => {
    const adm = await adminApi(browser, baseURL);
    const p = await cheapestPrize(adm);
    await api.devLogin('admin');
    await page.goto('/admin/cargo');
    // Проверка наличия, а не числа строк и порядка: в списке бывают и другие грузы.
    await expect
      .poll(() => page.getByTestId('admin-cargo-slug').allTextContents())
      .toEqual(expect.arrayContaining(['light', 'black', 'free', 'signal', 'special']));

    await page.getByTestId('admin-cargo-new').click();
    await expect(page).toHaveURL(new RegExp(`/admin/cargo/new\\?game=${GAME}$`));
    const slug = nextSlug();
    await page.locator('#cargo-name').fill(`E2E груз ${slug.slice(PREFIX.length)}`);
    await page.locator('#cargo-slug').fill(slug);
    await page.getByTestId('admin-cargo-prize-search').fill(p.fullName);
    await page
      .getByTestId('admin-cargo-prize-option')
      .filter({ hasText: p.fullName })
      .first()
      .click();
    await page.locator('#cargo-seatsTotal').fill('20');
    await page.locator('#cargo-seatPrice').fill('10');
    await page.locator('#cargo-sortOrder').fill('99999');
    await page.getByTestId('admin-cargo-save').click();

    await expect(page).toHaveURL(new RegExp(`/admin/cargo/[0-9a-f-]{36}\\?game=${GAME}$`));
    const id = new URL(page.url()).pathname.split('/').pop()!;
    created.add(id);
    await expect(page.getByTestId('admin-cargo-round')).toContainText('Текущий раунд №1');
    await expect(page.getByTestId('admin-cargo-archive')).toBeDisabled();
    await expect(page.getByTestId('admin-cargo-archive-blocked')).toHaveText(
      'Выключите груз и отмените текущий раунд',
    );
    const saved = await adm.get<AdminCargoDetailDto>(`/admin/cargo/${id}`);
    expect(saved.body).toMatchObject({
      slug,
      seatsTotal: 20,
      seatPrice: 10,
      isActive: true,
      sortOrder: 99_999,
      prize: { id: p.id },
      round: { number: 1, status: 'open' },
    });
  });

  test('отмена раунда с возвратом гемов и аудитом, затем архив', async ({
    page,
    api,
    browser,
    baseURL,
  }) => {
    const adm = await adminApi(browser, baseURL);
    const cargo = await createCargo(adm, { seats: 10 });
    const other = await otherPlayer(browser, baseURL, 'cargoR');
    try {
      const before = (await other.api.me()).balance;
      await buyVia(other.api, cargo, 2);
      expect((await other.api.me()).balance).toBe(before - 2 * cargo.seatPrice);

      await api.devLogin('admin');
      await page.goto(`/admin/cargo/${cargo.id}?game=${GAME}`);
      const round = page.getByTestId('admin-cargo-round');
      await expect(round).toContainText('Текущий раунд №1');
      await expect(round).toContainText(other.me.nickname);
      // Выключить: иначе отмена сразу откроет раунд №2, а в архив — только без открытого раунда.
      await page.getByRole('switch', { name: 'Активен' }).click();
      await page.getByTestId('admin-cargo-save').click();
      await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
      await expect(page.getByTestId('admin-cargo-archive-blocked')).toHaveText(
        'Отмените текущий раунд',
      );

      await page.getByTestId('admin-cargo-cancel').click();
      await expect(page.getByTestId('admin-cargo-cancel-modal')).toBeVisible();
      // Отмена не тайное вето (D33): окно предупреждает, что исход раунда станет публичным.
      await expect(page.getByTestId('admin-cargo-cancel-public')).toHaveText(
        'После отмены server seed раскроется, и на странице проверки любой увидит, какое место выиграло бы.',
      );
      const reason = page.getByTestId('admin-cargo-cancel-reason');
      const confirm = page.getByTestId('admin-cargo-cancel-confirm');
      await reason.fill('abc');
      await expect(confirm).toBeDisabled();
      const why = `e2e: отмена раунда ${cargo.slug}`;
      await reason.fill(why);
      await confirm.click();
      await expect(page.getByText('Раунд отменён, гемы возвращены', { exact: true })).toBeVisible();
      await expect.poll(async () => (await other.api.me()).balance).toBe(before);

      // Фильтр аудита страница из адреса не читает — запись смотрим через API.
      const audit = await adm.get<AdminPageDto<AdminAuditRowDto>>(
        '/admin/audit?entityType=cargo_round',
      );
      expectOk(audit);
      expect(audit.body.items.find((a) => a.entityId === cargo.roundId)).toMatchObject({
        action: 'cargo_round.cancel',
        reason: why,
      });
      await other.api.expectLedgerConsistent();

      // Раунда больше нет — «В архив»: груз пропадает из списка, но есть при «Показать архив».
      const archive = page.getByTestId('admin-cargo-archive');
      await expect(archive).toBeEnabled();
      await archive.click();
      await page.getByTestId('admin-cargo-archive-confirm').click();
      await expect(page.getByText('Груз в архиве', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/admin/cargo\\?game=${GAME}$`));
      const slugs = page.getByTestId('admin-cargo-slug');
      await expect(slugs.filter({ hasText: /^light$/ })).toHaveCount(1);
      await expect(slugs.filter({ hasText: new RegExp(`^${cargo.slug}$`) })).toHaveCount(0);
      await page.getByRole('switch', { name: 'Показать архив' }).click();
      await expect(slugs.filter({ hasText: new RegExp(`^${cargo.slug}$`) })).toHaveCount(1);
    } finally {
      await other.close();
    }
  });
});

test.describe('Грузы в навигации', () => {
  test('«Грузы» в шапке и в меню профиля ведут на первый груз игры', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    const first = (await cargoList(api))[0]!;
    await page.goto(`/${GAME}`);
    // Шапка: пять пунктов; на 1366 — только иконки, подпись — в подсказке.
    const nav = page.getByRole('navigation', { name: 'Главная' });
    await expect(nav.getByRole('link')).toHaveCount(5);
    const headerLink = nav.getByRole('link', { name: 'Грузы' });
    await expect(headerLink).toHaveAttribute('href', `/${GAME}/cargo`);
    await expect(headerLink).toHaveAttribute('title', 'Грузы');

    await page.getByTestId('user-menu').filter({ visible: true }).click();
    const item = page.getByRole('menuitem', { name: 'Грузы' });
    await expect(item).toHaveAttribute('href', `/${GAME}/cargo`);
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/${GAME}/cargo/${first.slug}$`));
    await expect(page.getByTestId('cargo-title')).toHaveText(first.name);
  });
});
