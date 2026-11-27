import type { HomeDto, PublicConfigDto } from '@gunraid/shared';
import type { Locator } from '@playwright/test';
import { expect, test } from '../fixtures';

test.describe('Публичная часть', () => {
  test('главная обеих игр и переключатель игры @mobile', async ({ page, api, isMobile }) => {
    const config = (await api.get<PublicConfigDto>('/config')).body;
    const other = config.games.find((g) => g.code !== config.defaultGame);
    expect(other, 'в сидах две игры').toBeTruthy();

    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${config.defaultGame}$`));
    await expect(page.locator('[data-testid^="case-card-"]').first()).toBeVisible();

    // На телефоне выбор игры — в шторке «Меню» (шапка телефона: логотип, «Меню», «Вход»). Кнопка — по testid:
    // имя ищется подстрокой и совпало бы с «Закрыть меню», а с непрочитанными оно длиннее («Меню 3 новых …»).
    if (isMobile) await page.getByTestId('mobile-menu-open').click();
    // В шторке имя кнопки — «Выбрать игру: Standoff 2» (видимое название входит в имя), подстрока та же.
    await page.getByRole('button', { name: 'Выбрать игру' }).click();
    await page.getByRole('menuitemradio', { name: other!.name }).click();
    await expect(page).toHaveURL(new RegExp(`/${other!.code}$`));
    // Сменился путь — шторка закрылась сама.
    if (isMobile)
      await expect(page.getByRole('dialog', { name: 'Меню', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-testid^="case-card-"]').first()).toBeVisible();

    // Выбор запоминается: «/» ведёт в последнюю игру.
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${other!.code}$`));
  });

  test('гость: открыть кейс — сначала войти', async ({ page, api }) => {
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await expect(page.getByTestId('case-open')).toHaveCount(0);
    // Гостю — та же лаймовая «Открыть за N», но она ведёт ко входу.
    const open = page.getByTestId('case-open-login');
    await expect(open).toContainText(`Открыть за ${c.price}`);
    await open.click();
    await expect(page.getByTestId('dev-login-player')).toBeVisible();
    // Окно закрыто — фокус снова на кнопке, а не в начале страницы.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('login-modal')).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('футер: разделы ведут в текущую игру, документы открываются @mobile', async ({ page }) => {
    // Не игра по умолчанию (standoff2) — иначе ссылки «в текущую игру» не отличить от ссылок в игру по умолчанию.
    await page.goto('/cs2');
    // Плашка cookie на телефоне закрывает низ экрана — сначала отвечаем на неё.
    await page.getByTestId('cookie-banner').getByRole('button', { name: 'Принять все' }).click();
    const footer = page.getByTestId('site-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('link', { name: 'Апгрейд' })).toHaveAttribute(
      'href',
      '/cs2/upgrade',
    );
    // Пятый раздел — «Грузы»: гостю на телефоне и планшете их больше негде найти.
    await expect(footer.getByRole('link', { name: 'Грузы' })).toHaveAttribute('href', '/cs2/cargo');
    await expect(footer.getByRole('link')).toHaveCount(13);
    await expect(footer).toContainText(
      `© ${new Date().getFullYear()} GunRaid. Все права защищены.`,
    );
    await footer.getByRole('link', { name: 'Правила розыгрышей' }).click();
    await expect(page).toHaveURL(/\/legal\/giveaways$/);
    await expect(page.getByTestId('legal-doc')).toContainText('Правила розыгрышей');
  });

  test('правовые страницы и FAQ @mobile', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByTestId('legal-doc')).toContainText('TODO: юрист');
    for (const slug of [
      'privacy',
      'payments',
      'refunds',
      'bonuses',
      'giveaways',
      'rules',
      'age',
      'responsible',
    ]) {
      const res = await page.goto(`/legal/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId('legal-doc')).toBeVisible();
    }
    await page.goto('/faq');
    const items = page.getByTestId('faq-list').locator('details');
    expect(await items.count()).toBeGreaterThan(5);
    await items.first().locator('summary').click();
    await expect(items.first().locator('p')).toBeVisible();
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  });

  test('SEO: sitemap, robots, мета-теги и CSP', async ({ page, request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toMatch(/Sitemap: \S+\/sitemap\.xml/);

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(/\/cs2\/case\//);
    expect(sitemap).toMatch(/\/standoff2\/items\//);
    expect(sitemap).toContain('/legal/terms');
    expect(sitemap).toContain('/legal/giveaways');

    const res = await page.goto('/standoff2');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src [^;]*'nonce-/);
    expect(csp).toContain("object-src 'none'");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /\/brand\/og\.png$/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/standoff2$/);
  });

  test('cookie-баннер показывается один раз @mobile', async ({ page, isMobile }) => {
    await page.goto('/faq');
    const banner = page.getByTestId('cookie-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link')).toHaveAttribute('href', '/legal/cookies');
    await expect(banner.getByRole('button', { name: 'Отклонить' })).toBeVisible();
    // Плашка: на телефоне (42.png) — по центру над нижним меню (низ в 12 над ним, меню 60), не шире окна без
    // полей 12, скругление 18, заголовок 16, кнопки 36 в ряд; на десктопе — в правом нижнем углу в 24 от краёв.
    const vp = page.viewportSize()!;
    const panel = banner.locator('> div');
    const p = (await panel.boundingBox())!;
    if (isMobile) {
      expect(Math.abs(p.x - (vp.width - p.x - p.width))).toBeLessThan(0.5);
      expect(p.y + p.height).toBeCloseTo(vp.height - 72, 0);
      expect(p.width).toBeLessThanOrEqual(vp.width - 24);
      await expect(panel).toHaveCSS('border-top-left-radius', '18px');
      await expect(banner.locator('h2')).toHaveCSS('font-size', '16px');
      const [decline, accept] = await Promise.all(
        ['Отклонить', 'Принять все'].map(
          async (name) => (await banner.getByRole('button', { name }).boundingBox())!,
        ),
      );
      expect(decline!.height).toBeCloseTo(36, 0);
      expect(accept!.y).toBeCloseTo(decline!.y, 0);
      expect(accept!.x - decline!.x - decline!.width).toBeCloseTo(12, 0);
    } else {
      expect(p.x + p.width).toBeCloseTo(vp.width - 24, 0);
      expect(p.y + p.height).toBeCloseTo(vp.height - 24, 0);
    }
    // Пока плашка видна на телефоне, её высота — в --cookie-h на <html>: на столько (и ещё на зазор 12 над
    // меню) выше уходят прокрутка к элементу в фокусе и низ подвала. От 768 переменной нет — всё как без плашки.
    const bottoms = () =>
      page.evaluate(() => ({
        cookieH: document.documentElement.style.getPropertyValue('--cookie-h'),
        scroll: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
        footer: parseFloat(
          getComputedStyle(document.querySelector('[data-testid="site-footer"]')!).paddingBottom,
        ),
      }));
    if (isMobile)
      await expect.poll(async () => parseFloat((await bottoms()).cookieH)).toBeCloseTo(p.height, 1);
    const tabbar = isMobile ? 60 : 0;
    const under = isMobile ? tabbar + p.height + 12 : 0;
    const shown = await bottoms();
    if (!isMobile) expect(shown.cookieH).toBe('');
    expect(shown.scroll).toBeCloseTo(under + 16, 0);
    expect(shown.footer).toBeCloseTo(under + 24, 0);
    // Выбор с клавиатуры: нажатая кнопка исчезает вместе с плашкой — фокус возвращается туда, откуда пришёл.
    const before = page.getByTestId('site-footer').getByRole('link').first();
    await before.focus();
    await banner.getByRole('button', { name: 'Принять все' }).focus();
    await page.keyboard.press('Enter');
    await expect(banner).toBeHidden();
    await expect(before).toBeFocused();
    // Плашки нет — переменной тоже, снизу место только под нижнее меню (как при уже сделанном выборе).
    const gone = await bottoms();
    expect(gone.cookieH).toBe('');
    expect(gone.scroll).toBeCloseTo(tabbar + 16, 0);
    expect(gone.footer).toBeCloseTo(tabbar + 24, 0);
    await page.reload();
    await expect(page.getByTestId('faq-list')).toBeVisible();
    await expect(banner).toBeHidden();
  });

  test('несуществующий кейс — 404', async ({ page }) => {
    const res = await page.goto('/cs2/case/no-such-case-e2e');
    expect(res?.status()).toBe(404);
  });
});

/**
 * Главная под шапкой на телефоне (< 768, макет 360): баннер 150, фильтры 60 с панелью расширенных фильтров,
 * заголовки категорий и карточки 144 по две. На десктопе (проект desktop) — ветка «ничего не изменилось».
 */
test.describe('Главная на телефоне', () => {
  /** Подписи уровней адреналина в меню фильтра (ru.json → home.filters.levels). */
  const LEVEL_NAMES = {
    low: 'Низкий',
    normal: 'Средний',
    high: 'Высокий',
    extreme: 'Экстремальный',
  } as const;
  const box = async (l: Locator) => (await l.boundingBox())!;
  /** Поиск сайта: без учёта регистра, «ё» = «е» (lib/case-filters.ts). */
  const fold = (s: string) =>
    s
      .toLocaleLowerCase('ru')
      .normalize('NFD')
      .replace(/\u0308/g, '')
      .normalize('NFC');
  /** Витрина — без бесплатных кейсов и пустых категорий, как на странице. */
  const showcase = (home: HomeDto) =>
    home.categories
      .map((c) => ({ ...c, cases: c.cases.filter((k) => k.kind !== 'free') }))
      .filter((c) => c.cases.length > 0);

  test('баннер 150, фильтры 60, заголовки и карточки 144 по две @mobile', async ({
    page,
    api,
    isMobile,
  }) => {
    // api — ещё и тихие настройки: плашка cookie закрыта и не перекрывает низ экрана.
    const cats = showcase((await api.get<HomeDto>('/games/standoff2/home')).body);
    await page.goto('/standoff2');
    const filters = page.getByTestId('case-filters');
    await expect(filters).toBeVisible();
    const banner = page.getByTestId('bonus-banner');
    if (!isMobile) {
      // Десктоп не меняется: цена — в строке фильтров, кнопки расширенных фильтров нет, подзаголовок баннера виден.
      await expect(page.getByTestId('filter-price-min')).toBeVisible();
      await expect(page.getByTestId('filter-more')).toBeHidden();
      expect((await box(banner.locator('p'))).height).toBeGreaterThan(20);
      return;
    }
    // С isMobile Chromium растягивает clientWidth под переполнение — сравниваем с заданной шириной окна.
    const vw = page.viewportSize()!.width;
    const b = await box(banner);
    expect(b.x).toBeCloseTo(12, 0);
    expect(b.width).toBeCloseTo(vw - 24, 0);
    expect(b.height).toBeCloseTo(150, 0);
    await expect(banner).toHaveCSS('border-top-left-radius', '18px');
    // Заголовок 16 в 24 от левого края, под ним через 12 — кнопка 36; вместе — по центру по высоте.
    const h1 = await box(banner.locator('h1'));
    const cta = await box(banner.getByRole('button', { name: 'Забрать бонус' }));
    await expect(banner.locator('h1')).toHaveCSS('font-size', '16px');
    expect(h1.x - b.x).toBeCloseTo(24, 0);
    expect(cta.height).toBeCloseTo(36, 0);
    expect(cta.y - h1.y - h1.height).toBeCloseTo(12, 0);
    expect(Math.abs(h1.y - b.y - (b.y + b.height - cta.y - cta.height))).toBeLessThan(1.5);
    // Подзаголовок — только для экранных читалок: в дереве есть, на экране — нет.
    expect((await box(banner.locator('p'))).width).toBeLessThanOrEqual(1);
    await expect(banner.locator('p')).not.toBeEmpty();

    const f = await box(filters);
    expect(f.y - b.y - b.height).toBeCloseTo(12, 0);
    expect(f.height).toBeCloseTo(60, 0);
    const cat = await box(page.getByTestId('filter-category'));
    const search = await box(page.locator('label', { has: page.getByTestId('filter-search') }));
    const more = await box(page.getByTestId('filter-more'));
    for (const r of [cat, search, more]) {
      expect(r.height).toBeCloseTo(36, 0);
      expect(r.y - f.y).toBeCloseTo(12, 0);
    }
    expect(cat.x - f.x).toBeCloseTo(12, 0);
    expect(search.x - cat.x - cat.width).toBeCloseTo(12, 0);
    expect(more.x - search.x - search.width).toBeCloseTo(12, 0);
    expect(f.x + f.width - more.x - more.width).toBeCloseTo(12, 0);
    expect(more.width).toBeCloseTo(36, 0);
    // Видимые подписи короткие, имена — полные (видимый текст входит в имя).
    await expect(page.getByTestId('filter-category')).toHaveText('Категория', {
      useInnerText: true,
    });
    await expect(page.getByTestId('filter-category')).toHaveAccessibleName('Категория кейсов');
    await expect(page.getByTestId('filter-search')).toHaveAccessibleName('Поиск по названию');
    await expect(page.getByTestId('filter-price-min')).toBeHidden();
    await expect(page.getByTestId('filter-adrenaline')).toBeHidden();
    // iOS не увеличивает страницу при фокусе, если шрифт поля не меньше 16 (видно — 12, scale 0.75).
    const fontSize = await page
      .getByTestId('filter-search')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    // Плашка → 48 → заголовок категории DemiBold 16 → 48 → карточки; между категориями тоже 48.
    const sections = page.locator('[data-testid^="case-category-"]');
    await expect(sections).toHaveCount(cats.length);
    const h2 = await box(sections.first().locator('h2'));
    await expect(sections.first().locator('h2')).toHaveCSS('font-size', '16px');
    expect(h2.y - f.y - f.height).toBeCloseTo(48, 0);
    const cards = sections.first().locator('[data-testid^="case-card-"]');
    const [a, c2, c3] = [await box(cards.nth(0)), await box(cards.nth(1)), await box(cards.nth(2))];
    expect(a.y - h2.y - h2.height).toBeCloseTo(48, 0);
    const last = await box(cards.last());
    const h2b = await box(sections.nth(1).locator('h2'));
    expect(h2b.y - last.y - last.height).toBeCloseTo(48, 0);
    // Карточки 144 (уже 360 — (ширина − 72) / 2), по две в ряд, между ними 24, пара по центру.
    expect(a.width).toBeCloseTo(Math.min(144, (vw - 72) / 2), 0);
    expect(c2.x - a.x - a.width).toBeCloseTo(24, 0);
    expect(c2.y).toBeCloseTo(a.y, 0);
    expect(c3.x).toBeCloseTo(a.x, 0);
    expect(c3.y - a.y - a.height).toBeCloseTo(24, 0);
    expect(a.x).toBeCloseTo(vw - c2.x - c2.width, 0);
    // Внутри карточки: название 12, плашка цены 24, шкала адреналина 130×7 у низа.
    const tile = cards.first();
    await expect(tile.locator('.case-tile__name')).toHaveCSS('font-size', '12px');
    expect((await box(tile.locator('.case-tile__price'))).height).toBeCloseTo(24, 0);
    const bar = await box(tile.locator('.adrenaline-bar'));
    expect(bar.width).toBeCloseTo(130, 0);
    expect(bar.height).toBeCloseTo(7, 0);
    expect(bar.y + bar.height).toBeCloseTo(a.y + a.height, 0);

    // Без горизонтальной прокрутки и на самых узких окнах (на 320 её давал ModeGrid; 300 и 280 — крупный шрифт).
    for (const width of [vw, 360, 320, 300, 280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
  });

  test('фильтры: поиск, категория, панель расширенных фильтров @mobile', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(!isMobile, 'панель расширенных фильтров — только на телефоне');
    // Ожидания — из тех же данных, что видит страница.
    const cats = showcase((await api.get<HomeDto>('/games/standoff2/home')).body);
    const all = cats.flatMap((c) => c.cases);
    const cards = page.locator('[data-testid^="case-card-"]');
    await page.goto('/standoff2');
    await expect(cards).toHaveCount(all.length);

    // Поиск — без учёта регистра и разницы «ё» / «е».
    const target = all.at(-1)!;
    const search = page.getByTestId('filter-search');
    await search.fill(target.name.toLocaleUpperCase('ru'));
    await expect(cards).toHaveCount(
      all.filter((k) => fold(k.name).includes(fold(target.name))).length,
    );
    const yo = all.find((k) => /ё/i.test(k.name));
    if (yo) {
      await search.fill(yo.name.replace(/ё/g, 'е').replace(/Ё/g, 'Е'));
      await expect(page.getByTestId(`case-card-${yo.slug}`)).toBeVisible();
    }
    // Ничего не найдено — пустое состояние по шкале телефона (текст 12).
    await search.fill('такого кейса нет');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('Нет кейсов по этим фильтрам')).toHaveCSS('font-size', '12px');
    await search.fill('');
    await expect(cards).toHaveCount(all.length);

    // Категория: одна секция, на кнопке — название категории, оно же в имени кнопки.
    const second = (cats[1] ?? cats[0])!;
    const category = page.getByTestId('filter-category');
    await category.click();
    await page.getByRole('menuitemradio', { name: second.name }).click();
    await expect(page.locator('[data-testid^="case-category-"]')).toHaveCount(1);
    await expect(page.getByTestId(`case-category-${second.code}`)).toBeVisible();
    await expect(category).toContainText(second.name);
    await expect(category).toHaveAccessibleName(`Категория кейсов: ${second.name}`);

    // Панель: на ширину плашки, в 3 под ней; фокус — на панели (на телефоне не выезжает клавиатура).
    const more = page.getByTestId('filter-more');
    await expect(more).toHaveAccessibleName('Расширенные фильтры');
    await more.click();
    const panel = page.getByTestId('filter-more-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    // Shift+Tab с самой панели — на ластик, как с первого поля; панель не закрывается.
    await page.keyboard.press('Shift+Tab');
    await expect(panel.getByTestId('filter-reset')).toBeFocused();
    await expect(panel).toBeVisible();
    const f = await box(page.getByTestId('case-filters'));
    // Панель появляется с анимацией gr-pop (scale 0.98, сдвиг −4), а до расчёта позиции Radix держит её за экраном —
    // меряем установившуюся геометрию.
    await expect.poll(async () => (await box(panel)).width).toBeCloseTo(f.width, 0);
    await expect
      .poll(async () => {
        const p = await box(panel);
        return p.y - f.y - f.height;
      })
      .toBeCloseTo(3, 0);

    // Ластик в панели сбрасывает всё, включая категорию.
    await panel.getByTestId('filter-reset').click();
    await expect(cards).toHaveCount(all.length);
    await expect(category).toHaveAccessibleName('Категория кейсов');

    // Уровень — вложенное меню внутри панели: выбор не закрывает панель.
    const top = [...all].sort((x, y) => y.price - x.price)[0]!;
    await panel.getByTestId('filter-adrenaline').click();
    await page.getByRole('menuitemradio', { name: LEVEL_NAMES[top.adrenaline] }).click();
    await expect(panel).toBeVisible();
    await expect(cards).toHaveCount(all.filter((k) => k.adrenaline === top.adrenaline).length);
    await expect(more).toHaveAccessibleName('Расширенные фильтры: заданы');

    // Цена «до» — самый дешёвый кейс (уровень любой).
    await panel.getByTestId('filter-adrenaline').click();
    await page.getByRole('menuitemradio', { name: 'Любой уровень' }).click();
    const cheapest = Math.min(...all.map((k) => k.price));
    await panel.getByTestId('filter-price-max').fill(String(cheapest));
    await expect(cards).toHaveCount(all.filter((k) => k.price <= cheapest).length);

    // Esc закрывает панель, фокус возвращается на кнопку.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
  });
});
