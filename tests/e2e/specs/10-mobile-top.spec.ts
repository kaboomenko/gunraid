import type { FeedDropDto, ProfileStatsDto, UserItemDto } from '@gunraid/shared';
import type { Locator, Page } from '@playwright/test';
import { expect, separateApi, test } from '../fixtures';

/** Ширина страницы с прокруткой: с isMobile окно растягивается под переполнение — сравниваем с заданной шириной. */
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

/** Лучший дроп за 1 234 567 — самая длинная сумма, которая должна быть видна целиком (подменяется в /me/stats). */
const BEST_DROP: UserItemDto = {
  id: 'e2e-best',
  status: 'in_inventory',
  source: 'case',
  acquiredValue: 1_234_567,
  acquiredAt: '2026-11-01T10:00:00.000Z',
  soldValue: null,
  item: {
    id: 'e2e-best-item',
    fullName: 'M9 Bayonet | Dragon Glass',
    skinName: 'Dragon Glass',
    modelName: 'M9 Bayonet',
    typeCode: 'knife',
    rarity: { code: 'arcane', name: 'Arcane', color: '#DC2A2A', sortOrder: 7 },
    imageUrl: '/media/skins/so2/m9-bayonet-dragon-glass.webp',
    price: 1_234_567,
    isStattrak: false,
    isSouvenir: false,
    wear: null,
    floatMin: null,
    floatMax: null,
    isWithdrawable: true,
  },
};

/**
 * Верхний блок телефона (окно < 768, макет 36.png): шапка под рядом с лентой и её шторка «Меню». Кнопка «Меню» —
 * по testid: имя ищется подстрокой и совпало бы с «Закрыть меню», а с непрочитанными уведомлениями оно длиннее
 * («Меню 3 новых уведомления»); пока шторка открыта, Radix скрывает кнопку от дерева доступности.
 */
test.describe('Телефон: шапка и меню', () => {
  /** Рамка элемента: x, y, ширина, высота — с точностью до 0,5 px (DPR Pixel 7 — 2,625). */
  async function expectBox(locator: Locator, expected: [number, number, number, number]) {
    const b = (await locator.boundingBox())!;
    const actual = [b.x, b.y, b.width, b.height];
    expected.forEach((v, i) =>
      expect(Math.abs(actual[i]! - v), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(0.5),
    );
  }

  test('меню: открыть, Esc, фокус, переход; без горизонтальной прокрутки @mobile', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'шапка телефона');
    // Не главная: у неё свои правки телефона (части 2), здесь важна только шапка.
    await page.goto('/standoff2/upgrade');
    const open = page.getByTestId('mobile-menu-open');
    await expect(open).toHaveAccessibleName('Меню');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('login-button').filter({ visible: true })).toBeVisible();

    await open.click();
    const menu = page.getByRole('dialog', { name: 'Меню', exact: true });
    await expect(menu).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    // Фокус в шторке — на «Закрыть меню»; разделы — навигация, текущий отмечен.
    await expect(menu.getByRole('button', { name: 'Закрыть меню', exact: true })).toBeFocused();
    const nav = menu.getByRole('navigation', { name: 'Разделы сайта' });
    await expect(nav.getByRole('link')).toHaveCount(7);
    await expect(nav.getByRole('link', { name: 'Апгрейд' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(menu.getByRole('group', { name: 'Язык и звук' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await menu.getByRole('link', { name: 'Контракт' }).click();
    await expect(page).toHaveURL(/\/standoff2\/contract$/);
    await expect(menu).toBeHidden();

    // С isMobile clientWidth растягивается под переполнение — сравниваем с заданной шириной окна.
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 700 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
  });

  test('вошедший: баланс и «+» в шапке, выход из меню @mobile', async ({
    page,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'шапка телефона');
    await page.goto('/standoff2/upgrade');
    const balance = page.getByTestId('balance').filter({ visible: true });
    await expect(balance).toBeVisible();
    // Видимая сумма входит в имя кнопки баланса: «Баланс: 0 гемов».
    await expect(balance).toHaveAccessibleName(/^Баланс: [\d\s]+ гем(а|ов)?$/);
    const deposit = page.getByTestId('deposit-open').filter({ visible: true });
    await expect(deposit).toBeVisible();
    // «+» 36×36 у правого поля плашки шапки (окно − 12 поля страницы − 12 поля плашки).
    const width = page.viewportSize()!.width;
    await expectBox(deposit, [width - 24 - 36, 150, 36, 36]);

    await page.getByTestId('mobile-menu-open').click();
    const menu = page.getByRole('dialog', { name: 'Меню', exact: true });
    await expect(menu).toContainText(player.nickname);
    await expect(menu.getByRole('link', { name: 'Профиль' })).toHaveAttribute(
      'href',
      '/standoff2/profile',
    );
    // Звук: имя постоянное, включён ли — aria-pressed (у игрока e2e звук выключен).
    const sound = menu.getByRole('button', { name: 'Звуки сайта', exact: true });
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await expect(sound).toHaveAccessibleName('Звуки сайта');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await menu.getByRole('button', { name: 'Выйти' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('login-button').filter({ visible: true })).toBeVisible();
  });

  test('верхний блок 360: онлайн один, баннер, ряд и шапка по 60, контент через 12 @mobile', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'раскладка телефона');
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/standoff2/upgrade');
    await expect(page.getByRole('status').filter({ visible: true })).toHaveCount(1);
    await expectBox(page.getByTestId('promo-strip'), [12, 12, 336, 60]);
    await expectBox(page.getByTestId('online'), [12, 75, 58, 60]);
    const login = page.getByTestId('login-button').filter({ visible: true });
    await expectBox(login, [254, 150, 82, 36]);
    // Видимая шапка одна; под ней страница начинается через 12 (на 360 — с y 210).
    const header = page.locator('header').filter({ visible: true });
    await expect(header).toHaveCount(1);
    const main = await page.locator('main').evaluate((el) => {
      const top = el.getBoundingClientRect().top + scrollY;
      return top + parseFloat(getComputedStyle(el).paddingTop);
    });
    expect(main).toBe(210);

    // Окно уже 320 (крупный системный шрифт): у «Меню» только иконка, имя то же, шапка не вылезает за поле.
    await page.setViewportSize({ width: 280, height: 640 });
    const open = page.getByTestId('mobile-menu-open');
    await expect(open).toHaveAccessibleName('Меню');
    await expect.poll(async () => (await open.boundingBox())!.width).toBe(36);
    const right = await login.boundingBox();
    expect(right!.x + right!.width).toBeLessThanOrEqual(280 - 24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      280,
    );
  });

  test('вошедший на 280 с балансом 123 456 789: шапка в своём поле, логотип не под «Меню» @mobile', async ({
    page,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'шапка телефона');
    // Баланс подменяется в ответе /me: «123.46M» — самая длинная сумма до миллиарда. Логотип уменьшается, «+» — у
    // поля плашки, зона нажатия «Меню» (на 12 левее иконки) начинается не раньше конца логотипа.
    await page.route('**/api/v1/me', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), balance: 123_456_789 } });
    });
    await page.setViewportSize({ width: 280, height: 640 });
    await page.goto('/standoff2/upgrade');
    const balance = page.getByTestId('balance').filter({ visible: true });
    await expect(balance).toHaveText('123.46M');
    // Сокращённая запись входит в имя вместе с полной (WCAG 2.5.3: видимая подпись — часть имени).
    await expect(balance).toHaveAccessibleName('Баланс: 123.46M (123 456 789 гемов)');
    const logo = (await page.locator('header .logo-mask').filter({ visible: true }).boundingBox())!;
    const open = page.getByTestId('mobile-menu-open');
    const menu = (await open.boundingBox())!;
    const deposit = (await page
      .getByTestId('deposit-open')
      .filter({ visible: true })
      .boundingBox())!;
    expect(Math.abs(logo.x - 24)).toBeLessThanOrEqual(0.5);
    expect(menu.x).toBeGreaterThanOrEqual(logo.x + logo.width - 0.5);
    expect(deposit.x + deposit.width).toBeLessThanOrEqual(280 - 24 + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      280,
    );
    await open.click();
    await expect(page.getByRole('dialog', { name: 'Меню', exact: true })).toContainText(
      player.nickname,
    );
  });

  test('лента: остановки Tab — только карточки целиком в окне, окно после фокуса за краем — в начале @mobile', async ({
    page,
  }) => {
    // 12 дропов вместо живой ленты (на свежей базе её может не быть), сокет отключён — новые не приходят;
    // «меньше движения» — без автопрокрутки, карточки стоят.
    const drops: FeedDropDto[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e2e-drop-${i}`,
      game: 'standoff2',
      source: 'case',
      user: { shortId: 1000 + i, nickname: `e2e_${i}`, avatarUrl: null },
      item: {
        id: `e2e-item-${i}`,
        skinName: 'Dragon Glass',
        modelName: 'M9 Bayonet',
        imageUrl: null,
        rarityColor: '#DC2A2A',
        price: 1450,
      },
      caseSlug: null,
      caseName: null,
      caseImage: null,
      createdAt: new Date().toISOString(),
    }));
    await page.route('**/api/v1/games/*/feed', (route) => route.fulfill({ json: drops }));
    await page.route('**/socket.io/**', (route) => route.abort());
    await page.routeWebSocket(/socket\.io/, () => undefined);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/standoff2/upgrade');
    const feed = page.getByRole('region', { name: 'Последние дропы' });
    const cards = feed.locator('.drop-card');
    await expect(cards).toHaveCount(12);

    // Остановки Tab — ровно карточки, целиком попавшие в окно ленты (телефон 412 — три, десктоп 1366 — четыре).
    const stops = () =>
      feed.evaluate((section) => {
        const win = section.querySelector(':scope > div')!.getBoundingClientRect();
        return [...section.querySelectorAll<HTMLElement>('.drop-card')].map((c) => {
          const r = c.getBoundingClientRect();
          const full = r.left >= win.left - 0.5 && r.right <= win.right + 0.5;
          return c.tabIndex >= 0 === full ? (full ? 'full' : 'out') : 'wrong';
        });
      });
    await expect.poll(async () => (await stops()).includes('wrong')).toBe(false);
    const full = (await stops()).filter((s) => s === 'full').length;
    expect(full).toBeGreaterThan(0);

    // Shift+Tab с логотипа шапки (первая остановка после ленты) — на последнюю целую карточку.
    const logo = page.getByRole('link', { name: 'GunRaid', exact: true }).filter({ visible: true });
    await logo.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(cards.nth(full - 1)).toBeFocused();

    // Фокус на карточке за краем (так водит читалка) прокручивает окно; фокус ушёл из ленты — окно снова в начале.
    const scrollLeft = () => feed.evaluate((s) => s.querySelector(':scope > div')!.scrollLeft);
    await cards.nth(full + 3).focus();
    await expect.poll(scrollLeft).toBeGreaterThan(0);
    await logo.focus();
    await expect.poll(scrollLeft).toBe(0);
  });

  test('профиль: «Лучший дроп» за 1 234 567 виден целиком, ник из 24 букв — без прокрутки вбок @mobile', async ({
    page,
    player,
    isMobile,
  }) => {
    // Ответы подменяются в браузере (БД не трогаем): лучший дроп за 1 234 567 и ник из 24 широких букв.
    await page.route('**/api/v1/me/stats*', async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as ProfileStatsDto;
      await route.fulfill({ response: res, json: { ...body, bestDrop: BEST_DROP } });
    });
    await page.route('**/api/v1/me', async (route) => {
      const res = await route.fetch();
      await route.fulfill({
        response: res,
        json: { ...(await res.json()), nickname: 'Ж'.repeat(24) },
      });
    });
    await page.goto('/standoff2/profile');
    const best = page.locator('main .cut-sm').filter({ hasText: 'Лучший дроп' });
    await expect(best).toContainText('1 234 567');
    expect(player.shortId).toBeTruthy();
    // Телефон: карточка во всю строку под счётчиками. От 768: картинка уступает место сумме, если та не помещается.
    for (const width of isMobile ? [280, 360, 767] : [768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => scrollWidth(page)).toBeLessThanOrEqual(width);
      const card = (await best.boundingBox())!;
      const price = (await best.locator('[role="text"]').boundingBox())!;
      expect(price.x).toBeGreaterThanOrEqual(card.x);
      // в поле карточки (12 справа)
      expect(price.x + price.width).toBeLessThanOrEqual(card.x + card.width - 12 + 0.5);
      const nick = (await page.locator('main h1').boundingBox())!;
      expect(nick.x + nick.width).toBeLessThanOrEqual(width);
    }
  });

  test('публичный профиль: ник из 24 букв режется многоточием, без прокрутки вбок @mobile', async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    // Профиль рисует сервер — подменить ответ нельзя: отдельный игрок с длинным ником (широкие буквы).
    const other = await separateApi(browser, baseURL);
    const user = await other.api.devLogin(
      'player',
      `${'Ж'.repeat(15)}_${Math.random().toString(36).slice(2, 10)}`,
    );
    await other.close();
    await page.goto(`/standoff2/u/${user.shortId}`);
    const nick = page.locator('main h1');
    await expect(nick).toHaveText(user.nickname);
    const card = page.locator('main [class*="stripes"]').first();
    for (const width of isMobile ? [280, 360, 767] : [768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => scrollWidth(page)).toBeLessThanOrEqual(width);
      const c = (await card.boundingBox())!;
      const n = (await nick.boundingBox())!;
      expect(n.x + n.width).toBeLessThanOrEqual(c.x + c.width);
      // на 360 ник не помещается — обрезан (многоточие), а не перенесён и не вылез
      if (width === 360)
        expect(await nick.evaluate((h) => h.scrollWidth > h.clientWidth)).toBe(true);
    }
  });

  test('окно входа: нажатие по тосту не закрывает окно @mobile', async ({ page }) => {
    await page.goto('/standoff2/upgrade');
    await page.getByTestId('login-button').filter({ visible: true }).click();
    const dialog = page.getByTestId('login-modal');
    await expect(dialog).toBeVisible();
    // Без согласия с офертой вход не начинается — поверх окна тост «Чтобы войти, примите условия…».
    await dialog.getByTestId('login-google').click();
    const toast = page.locator('.gr-toast').filter({ hasText: 'примите условия' });
    await expect(toast).toBeVisible();
    await toast.click({ position: { x: 60, y: 12 } });
    await expect(dialog).toBeVisible();
    await toast.getByRole('button', { name: '×' }).click();
    await expect(toast).toBeHidden();
    await expect(dialog).toBeVisible();
  });

  test('пополнение: ручка шторки в 8 под кромкой, нажатие по тосту не закрывает окно @mobile', async ({
    page,
    player,
    isMobile,
  }) => {
    expect(player.balance).toBe(0);
    await page.goto('/standoff2/upgrade');
    await page.getByTestId('deposit-open').filter({ visible: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Пополнение баланса' });
    await expect(dialog).toBeVisible();
    if (isMobile) {
      // Шторка снизу (окно < 640): ручка — первый узел рамки .cut, в 8 под её верхней кромкой (отступ не схлопывается).
      const offset = await dialog.evaluate((el) => {
        const cut = el.querySelector(':scope > .cut')!;
        return cut.firstElementChild!.getBoundingClientRect().top - cut.getBoundingClientRect().top;
      });
      expect(Math.abs(offset - 8)).toBeLessThanOrEqual(0.5);
    }
    // Неверный промокод — тост с ошибкой поверх окна: нажатие по нему и по его крестику окно не закрывает.
    const promo = dialog.getByTestId('deposit-promo');
    await promo.fill('E2ENOSUCHPROMO');
    await dialog.getByRole('button', { name: 'Применить' }).click();
    const toast = page.locator('.gr-toast').filter({ hasText: 'Такого промокода нет' });
    await expect(toast).toBeVisible();
    await toast.click({ position: { x: 60, y: 12 } });
    await expect(dialog).toBeVisible();
    await toast.getByRole('button', { name: '×' }).click();
    await expect(toast).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(promo).toHaveValue('E2ENOSUCHPROMO');
  });
});
