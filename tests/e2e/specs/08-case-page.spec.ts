import type { CaseCardDto, CaseDetailDto, CaseOpenResultDto, HomeDto } from '@gunraid/shared';
import type { Page } from '@playwright/test';
import { expect, expectOk, test, type Api } from '../fixtures';

/** Платные кейсы в порядке каталога главной — по нему идут соседние кейсы на странице кейса. */
async function catalogue(api: Api, game: string): Promise<CaseCardDto[]> {
  const home = (await api.get<HomeDto>(`/games/${game}/home`)).body;
  return home.categories.flatMap((c) => c.cases).filter((c) => c.kind !== 'free');
}

test.describe('Страница кейса', () => {
  test('соседние кейсы при x1, копии кейса при x2+, стрелки переключают кейс', async ({
    page,
    api,
  }) => {
    const list = await catalogue(api, 'standoff2');
    expect(list.length, 'в каталоге больше двух кейсов').toBeGreaterThan(2);
    const [prev, current, next] = list as [CaseCardDto, CaseCardDto, CaseCardDto];
    const last = list[list.length - 1]!;

    await page.goto(`/standoff2/case/${current.slug}`);
    await expect(page.getByTestId('case-name')).toHaveText(current.name);
    await expect(page.getByTestId('case-copy')).toHaveCount(1);
    // Дроплента — только на телефоне (< 768); на десктопе рулетка крутится на месте кейса.
    await expect(page.getByTestId('case-strip')).toBeHidden();
    // Десктоп 1366: соседи помещаются, не касаясь стрелок.
    await expect(page.getByTestId('case-neighbour-prev')).toBeVisible();
    await expect(page.getByTestId('case-neighbour-prev')).toContainText(prev.name);
    await expect(page.getByTestId('case-neighbour-next')).toContainText(next.name);
    await expect(page.getByTestId('case-arrow-next')).toHaveAttribute(
      'aria-label',
      `Следующий кейс: ${next.name}`,
    );

    // От x2 соседей и стрелок нет — на сцене N копий кейса.
    for (const n of [2, 3, 5]) {
      await page.getByTestId(`case-count-${n}`).click();
      await expect(page.getByTestId(`case-count-${n}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('case-copy')).toHaveCount(n);
      await expect(page.getByTestId('case-neighbour-prev')).toHaveCount(0);
      await expect(page.getByTestId('case-arrow-prev')).toHaveCount(0);
      await expect(page.getByTestId('case-arrow-next')).toHaveCount(0);
    }
    await page.getByTestId('case-count-1').click();
    await expect(page.getByTestId('case-copy')).toHaveCount(1);
    await expect(page.getByTestId('case-arrow-next')).toBeVisible();

    // Стрелки ведут к соседям по каталогу главной.
    await page.getByTestId('case-arrow-next').click();
    await expect(page).toHaveURL(new RegExp(`/standoff2/case/${next.slug}$`));
    await expect(page.getByTestId('case-name')).toHaveText(next.name);
    await page.getByTestId('case-arrow-prev').click();
    await expect(page).toHaveURL(new RegExp(`/standoff2/case/${current.slug}$`));
    await expect(page.getByTestId('case-name')).toHaveText(current.name);

    // С клавиатуры: Enter на стрелке — переход, фокус остаётся на той же стрелке нового кейса.
    await page.getByTestId('case-arrow-next').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/standoff2/case/${next.slug}$`));
    await expect(page.getByTestId('case-arrow-next')).toBeFocused();

    // По кругу: слева от первого кейса — последний; клик по соседу тоже переключает.
    await page.goto(`/standoff2/case/${prev.slug}`);
    await expect(page.getByTestId('case-neighbour-prev')).toContainText(last.name);
    await page.getByTestId('case-neighbour-next').click();
    await expect(page).toHaveURL(new RegExp(`/standoff2/case/${current.slug}$`));
  });

  test('бесплатный кейс: без соседей и выбора количества', async ({ page, api }) => {
    const home = (await api.get<HomeDto>('/games/standoff2/home')).body;
    const free = home.categories.flatMap((c) => c.cases).find((c) => c.kind === 'free');
    test.skip(!free, 'в сидах нет бесплатного кейса');
    await page.goto(`/standoff2/case/${free!.slug}`);
    await expect(page.getByTestId('case-open-login')).toContainText('Открыть бесплатно');
    await expect(page.getByTestId('case-count-1')).toHaveCount(0);
    await expect(page.getByTestId('case-arrow-prev')).toHaveCount(0);
    await expect(page.getByTestId('case-neighbour-next')).toHaveCount(0);
  });

  test('содержимое кейса: тип, скин, цена и шанс на каждой карточке', async ({ page, api }) => {
    const c = await api.cheapestCase('cs2');
    const detail = (await api.get<CaseDetailDto>(`/games/cs2/cases/${c.slug}`)).body;
    await page.goto(`/cs2/case/${c.slug}`);
    const cards = page.getByTestId('case-item');
    await expect(cards).toHaveCount(detail.items.length);
    for (const [i, entry] of detail.items.slice(0, 3).entries()) {
      const card = cards.nth(i);
      await expect(card).toHaveAttribute('href', `/cs2/items/${entry.item.id}`);
      await expect(card.getByTestId('skin-card-skin')).toHaveText(entry.item.skinName);
      if (entry.item.modelName)
        await expect(card.getByTestId('skin-card-weapon')).toContainText(entry.item.modelName);
      const price = await card.getByTestId('skin-card-price-value').innerText();
      expect(price.replace(/\D/g, '')).toBe(String(entry.item.price));
      const chance = Number(entry.chance);
      await expect(card.getByTestId('skin-card-chance')).toHaveText(
        chance >= 0.01 ? `${chance.toFixed(2)}%` : /^0\.0\d+%$/,
      );
    }
  });

  test('не хватает гемов: красная кнопка, «Недостаточно средств», окно пополнения', async ({
    page,
    api,
    player,
  }) => {
    expect(player.balance).toBe(0);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    const open = page.getByTestId('case-open');
    await expect(open).toHaveAttribute('data-state', 'insufficient');
    const info = page.getByTestId('case-info');
    await expect(info).toHaveText('Недостаточно средств');
    await expect(info).toHaveAttribute('data-tone', 'error');
    await open.click();
    await expect(page.getByTestId('deposit-pay')).toBeVisible();
    // Кейс не открылся, гемы не списаны.
    expect((await api.inventory('cs2')).items).toHaveLength(0);
  });

  test('рулетка: x3 — три дорожки, x1 — горизонтальная лента; после окна — снова сцена', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);

    await page.getByTestId('case-count-3').click();
    const open = page.getByTestId('case-open');
    await expect(open).toHaveAttribute('data-state', 'ready');
    await expect(open).toContainText(`Открыть за ${c.price * 3}`);
    await open.click();
    await expect(page.getByTestId('case-roulette')).toHaveAttribute('data-lanes', '3');
    await expect(page.getByTestId('case-lane')).toHaveCount(3);
    await expect(page.getByTestId('result-sell-all')).toBeVisible();
    // Окно результата на десктопе прежнее: плитки предметов и заголовок прописными (шкала телефона — только < 768).
    await expect(page.getByTestId('result-item')).toHaveCount(0);
    expect((await resultWindow(page)).titleFont).toBe('20px/800/uppercase');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('case-roulette')).toHaveCount(0);
    await expect(page.getByTestId('case-copy')).toHaveCount(3);
    // Фокус вернулся на кнопку открытия — с клавиатуры можно сразу открыть ещё раз.
    await expect(open).toBeFocused();

    await page.getByTestId('case-count-1').click();
    await open.click();
    await expect(page.getByTestId('case-roulette')).toHaveAttribute('data-lanes', '1');
    await expect(page.getByTestId('case-lane')).toHaveCount(0);
    await expect(page.getByTestId('result-sell-all')).toBeVisible();

    const inv = await api.inventory('cs2');
    expect(inv.items.filter((i) => i.status === 'in_inventory')).toHaveLength(4);
    await api.expectLedgerConsistent();
  });

  test('«Быстро» у профиля без быстрого режима: результат сразу, выбор не сбрасывается', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    // Как у нового аккаунта: в профиле быстрый режим выключен.
    expectOk(await api.send('PATCH', '/me/settings', { fastModeDefault: false }));
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    const fast = page.getByTestId('case-fast');
    await expect(fast).toHaveAttribute('aria-pressed', 'false');
    await fast.click();
    await expect(fast).toHaveAttribute('aria-pressed', 'true');

    const open = page.getByTestId('case-open');
    await expect(open).toHaveAttribute('data-state', 'ready');
    await open.click();
    // Прокрутка идёт 5,6 с — с «Быстро» окно результата появляется сразу.
    await expect(page.getByTestId('result-sell-all')).toBeVisible({ timeout: 3_000 });
    // Баланс по WebSocket и перезапрос профиля после открытия выбор не сбрасывают.
    await expect(fast).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();

    // Выбор сохранён в профиле: после перезагрузки «Быстро» по-прежнему включено.
    await expect.poll(async () => (await api.me()).settings.fastModeDefault).toBe(true);
    await page.reload();
    await expect(fast).toHaveAttribute('aria-pressed', 'true');
  });
});

/** Ответ на открытие кейса (выигрыши решает сервер — по нему сверяем, что стоит под меткой). */
function openResponse(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && /\/cases\/[^/]+\/open$/.test(new URL(r.url()).pathname),
  );
}

/**
 * id предмета карточки под меткой ленты lane дропленты (центр карточки = центр окна ±1). Сверяем по id, а не
 * по названию скина: у разных предметов кейса оно может совпадать.
 */
function centredItem(page: Page, lane: number) {
  return page.evaluate((i) => {
    const l = document.querySelectorAll('[data-testid="case-strip-lane"]')[i];
    const win = l?.querySelector('.case-strip__window')?.getBoundingClientRect();
    if (!l || !win) return null;
    const mid = win.x + win.width / 2;
    const card = [...l.querySelectorAll('[data-testid="case-strip-card"]')].find((c) => {
      const b = c.getBoundingClientRect();
      return Math.abs(b.x + b.width / 2 - mid) <= 1;
    });
    return card?.getAttribute('data-item-id') ?? null;
  }, lane);
}

/**
 * Окно результата одним замером: рамки (CSS px окна), шрифт заголовка и кнопок («размер/насыщенность/регистр»),
 * скругление кнопок; в окне ли фокус.
 */
function resultWindow(page: Page) {
  return page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find(
      (x) => x.getClientRects().length,
    );
    const R = (el: Element | null | undefined) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
    };
    const font = (el: Element | null | undefined) => {
      if (!el) return '';
      const s = getComputedStyle(el);
      return `${s.fontSize}/${s.fontWeight}/${s.textTransform}`;
    };
    const title = d?.querySelector('h2');
    return {
      focusInside: Boolean(d?.contains(document.activeElement)),
      dialog: R(d),
      title: R(title),
      titleFont: font(title),
      // Крестик — первая кнопка окна (в строке заголовка).
      close: R(d?.querySelector('button')),
      cards: [...(d?.querySelectorAll('[data-testid="result-item"]') ?? [])].map(R),
      buttons: ['result-sell-all', 'result-open-again'].map((id) => {
        const b = d?.querySelector(`[data-testid="${id}"]`);
        return { box: R(b), font: font(b), radius: b ? getComputedStyle(b).borderRadius : '' };
      }),
    };
  });
}

/** Рамки страницы кейса одним замером (CSS px от верха документа) и нужные вычисленные стили. */
function phoneLayout(page: Page) {
  return page.evaluate(() => {
    const R = (el: Element | null | undefined) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y + scrollY,
        w: b.width,
        h: b.height,
        r: b.right,
        b: b.bottom + scrollY,
      };
    };
    const q = (s: string) => document.querySelector(s);
    const font = (s: string) => {
      const el = q(s);
      return el ? `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}` : '';
    };
    const header = [...document.querySelectorAll('header')].filter(
      (h) => h.getClientRects().length,
    );
    const lane = q('[data-testid="case-strip-lane"]');
    return {
      scrollW: document.documentElement.scrollWidth,
      header: R(header[header.length - 1]),
      name: R(q('[data-testid="case-name"]')),
      nameFont: font('[data-testid="case-name"]'),
      copy: R(q('[data-testid="case-copy"]')),
      prev: R(q('[data-testid="case-arrow-prev"]')),
      next: R(q('[data-testid="case-arrow-next"]')),
      arrowRadius: getComputedStyle(q('[data-testid="case-arrow-prev"]')!).borderRadius,
      arrowIcon: R(q('[data-testid="case-arrow-prev"] svg')),
      counts: [1, 2, 3, 4, 5].map((n) => R(q(`[data-testid="case-count-${n}"]`))),
      countFont: font('[data-testid="case-count-1"]'),
      fast: R(q('[data-testid="case-fast"]')),
      fastFont: font('[data-testid="case-fast"]'),
      open: R(q('[data-testid="case-open"]')),
      openFont: font('[data-testid="case-open"]'),
      info: R(q('[data-testid="case-info"]')),
      infoFont: font('[data-testid="case-info"]'),
      strip: R(q('[data-testid="case-strip"]')),
      marker: R(q('[data-testid="case-strip-marker"]')),
      cards: lane
        ? [...lane.querySelectorAll('[data-testid="case-strip-card"]')].slice(0, 2).map(R)
        : [],
      items: [...document.querySelectorAll('[data-testid="case-item"]')].slice(0, 4).map(R),
    };
  });
}

test.describe('Страница кейса на телефоне (макет 39.png)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  /** Геометрия — ±0.5 px от спецификации и макета. */
  const near = (actual: number | undefined, expected: number, what: string) =>
    expect(
      Math.abs((actual ?? NaN) - expected),
      `${what}: ${actual} ≈ ${expected}`,
    ).toBeLessThanOrEqual(0.5);

  test('раскладка 360: название, кейс, стрелки, кнопки, строка, дроплента и содержимое — по макету @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'раскладка телефона');
    expect(player.balance).toBe(0); // как на макете — «Недостаточно средств»
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await expect(page.getByTestId('case-open')).toHaveAttribute('data-state', 'insufficient');
    await expect(page.getByTestId('case-info')).toHaveText('Недостаточно средств');
    // Шрифт без preload (swap): до его загрузки текст рисует подогнанный Arial — ширины другие.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const m = await phoneLayout(page);
    const [x1, , , , x5] = m.counts;

    expect(m.scrollW, 'нет прокрутки вбок').toBeLessThanOrEqual(360);
    near(m.name!.y - m.header!.b, 48, 'шапка → прописные названия');
    expect(m.nameFont).toBe('16px/600');
    near(m.copy!.w, 120, 'кейс: ширина');
    near(m.copy!.h, 120, 'кейс: высота');
    near(m.copy!.x, 120, 'кейс по центру');
    near(m.copy!.y - m.name!.b, 12, 'название → кейс');
    near(m.prev!.w, 24, 'стрелка 24');
    near(m.prev!.h, 24, 'стрелка 24');
    expect(m.arrowRadius).toBe('4px');
    near(m.arrowIcon!.w, 8, 'иконка стрелки 8');
    near(m.copy!.x - m.prev!.r, 48, 'стрелка ← кейс');
    near(m.next!.x - m.copy!.r, 48, 'кейс → стрелка');
    near(m.prev!.y + 12, m.copy!.y + 60, 'стрелка по центру кейса');
    m.counts.forEach((k, i) => {
      near(k!.w, 36, `x${i + 1}: ширина`);
      near(k!.h, 36, `x${i + 1}: высота`);
      near(k!.x, 12 + 39 * i, `x${i + 1}: 12 от края, зазор 3`);
    });
    expect(m.countFont).toBe('12px/500');
    near(x1!.y - m.copy!.b, 24, 'кейс → ряд');
    near(m.fast!.y, x1!.y, '«Быстро» в ряду с x1…x5');
    near(m.fast!.r, 348, '«Быстро» у правого поля');
    expect(Math.abs(m.fast!.w - 97)).toBeLessThanOrEqual(1);
    expect(m.fastFont).toBe('12px/600');
    expect(m.fast!.x).toBeGreaterThan(x5!.r);
    near(m.open!.x, 12, 'кнопка открытия: слева');
    near(m.open!.w, 336, 'кнопка открытия во всю ширину');
    near(m.open!.h, 36, 'кнопка открытия: высота');
    near(m.open!.y - x1!.b, 12, 'ряд → кнопка');
    expect(m.openFont).toBe('12px/600');
    near(m.info!.y - m.open!.b, 8, 'кнопка → строка');
    expect(m.infoFont).toBe('12px/500');
    near(m.strip!.x, 0, 'дроплента от левого края экрана');
    near(m.strip!.w, 360, 'дроплента до правого края экрана');
    near(m.marker!.y - m.info!.b, 39, 'строка → метка');
    near(m.marker!.w, 274, 'метка: ширина');
    near(m.marker!.h, 3, 'метка: высота');
    near(m.marker!.x, 43, 'метка по центру');
    near(m.cards[0]!.y - m.marker!.y, 6, 'метка → карточки');
    near(m.cards[0]!.w, 90, 'карточка ленты: ширина');
    near(m.cards[0]!.h, 60, 'карточка ленты: высота');
    near(m.cards[1]!.x - m.cards[0]!.x, 93, 'шаг ленты');
    expect(m.items.length).toBeGreaterThanOrEqual(4);
    near(m.items[0]!.y - m.cards[0]!.b, 77, 'дроплента → содержимое');
    near(m.items[0]!.w, 108, 'карточка содержимого: ширина');
    near(m.items[0]!.h, 72, 'карточка содержимого: высота');
    near(m.items[0]!.x, 12, 'сетка: от левого поля');
    near(m.items[1]!.x - m.items[0]!.r, 6, 'сетка: зазор по горизонтали');
    near(m.items[3]!.y - m.items[0]!.b, 6, 'сетка: зазор по вертикали');
  });

  test('дроплента: выигрыш останавливается под меткой, кейс остаётся на месте @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'дроплента — только на телефоне');
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    const strip = page.getByTestId('case-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-state', 'idle');
    const open = page.getByTestId('case-open');
    await expect(open).toHaveAttribute('data-state', 'ready');
    const opened = openResponse(page);
    await open.click();
    const res = (await (await opened).json()) as CaseOpenResultDto;
    await expect(page.getByTestId('result-sell-all')).toBeVisible();
    // Рулетка на месте кейса не появлялась: кейс остался, крутилась дроплента.
    await expect(page.getByTestId('case-roulette')).toHaveCount(0);
    await expect(page.getByTestId('case-copy')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect(strip).toHaveAttribute('data-state', 'spun');
    await expect.poll(() => centredItem(page, 0)).toBe(res.results[0]!.item.id);
  });

  test('x3: три копии кейса и три ленты, у каждой — свой выигрыш; x1 — снова одна лента @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'дроплента — только на телефоне');
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await page.getByTestId('case-count-3').click();
    await expect(page.getByTestId('case-copy')).toHaveCount(3);
    await expect(page.getByTestId('case-strip-lane')).toHaveCount(3);
    const opened = openResponse(page);
    await page.getByTestId('case-open').click();
    const res = (await (await opened).json()) as CaseOpenResultDto;
    expect(res.results).toHaveLength(3);
    await expect(page.getByTestId('result-sell-all')).toBeVisible();
    // Окно результата по шкале телефона: поля 12, заголовок DemiBold 16 без капса, три карточки ровно по 108,
    // кнопки 36 с DemiBold 12 без капса, скругление 6; фокус — в окне, Esc возвращает его на «Открыть».
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const w = await resultWindow(page);
    expect(w.focusInside, 'фокус в окне').toBe(true);
    near(w.title!.x - w.dialog!.x, 12, 'окно: поле слева');
    near(w.dialog!.r - w.close!.r, 12, 'окно: поле справа');
    near(w.close!.w, 36, 'крестик 36');
    expect(w.titleFont).toBe('16px/600/none');
    expect(w.cards).toHaveLength(3);
    for (const card of w.cards) {
      near(card!.w, 108, 'карточка в окне: ширина');
      near(card!.h, 72, 'карточка в окне: высота');
    }
    near(w.cards[0]!.x - w.dialog!.x, 12, 'карточки от поля окна');
    near(w.cards[1]!.x - w.cards[0]!.r, 6, 'карточки через 6');
    for (const b of w.buttons) {
      near(b.box!.h, 36, 'кнопка окна: высота');
      expect(b.font).toBe('12px/600/none');
      expect(b.radius).toBe('6px');
    }
    await page.keyboard.press('Shift+Tab');
    expect((await resultWindow(page)).focusInside, 'Tab не уводит фокус из окна').toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('case-open')).toBeFocused();
    await expect(page.getByTestId('case-strip-lane')).toHaveCount(3);
    for (const [i, r] of res.results.entries())
      await expect.poll(() => centredItem(page, i)).toBe(r.item.id);
    // Повторное нажатие на выбранное количество выигрыш не сбрасывает.
    await page.getByTestId('case-count-3').click();
    await expect(page.getByTestId('case-strip')).toHaveAttribute('data-state', 'spun');
    await expect.poll(() => centredItem(page, 0)).toBe(res.results[0]!.item.id);
    await page.getByTestId('case-count-1').click();
    await expect(page.getByTestId('case-strip-lane')).toHaveCount(1);
    await expect(page.getByTestId('case-strip')).toHaveAttribute('data-state', 'idle');
  });

  test('пока крутится дроплента, стрелки неактивны @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'дроплента — только на телефоне');
    expect(player.id).toBeTruthy();
    // Обычный режим: прокрутка 5.6 с (не «Быстро»).
    expectOk(await api.send('PATCH', '/me/settings', { fastModeDefault: false }));
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await expect(page.getByTestId('case-fast')).toHaveAttribute('aria-pressed', 'false');
    const next = page.getByTestId('case-arrow-next');
    await expect(next).not.toHaveAttribute('inert');
    await page.getByTestId('case-open').click();
    await expect(next).toHaveAttribute('inert', '');
    await expect(page.getByTestId('result-sell-all')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(next).not.toHaveAttribute('inert');
  });

  test('поворот посреди прокрутки: показ доводится сразу, окно итога — в шкале новой ширины @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'поворот телефона');
    expect(player.id).toBeTruthy();
    // Обычный режим: прокрутка 5.6 с — поворот приходится на её середину.
    expectOk(await api.send('PATCH', '/me/settings', { fastModeDefault: false }));
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    // Ландшафт (≥ 768): крутится рулетка на месте кейса.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto(`/cs2/case/${c.slug}`);
    await expect(page.getByTestId('case-fast')).toHaveAttribute('aria-pressed', 'false');
    const opened = openResponse(page);
    await page.getByTestId('case-open').click();
    const res = (await (await opened).json()) as CaseOpenResultDto;
    await expect(page.getByTestId('case-roulette')).toBeVisible();
    // Портрет (< 768): рулетки сцены нет, выигрыш сразу под меткой дропленты, окно — по шкале телефона.
    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page.getByTestId('result-sell-all')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('case-roulette')).toHaveCount(0);
    expect((await resultWindow(page)).titleFont).toBe('16px/600/none');
    // Снова ландшафт с открытым окном — окно десктопа; обратно — телефона.
    await page.setViewportSize({ width: 915, height: 412 });
    await expect.poll(async () => (await resultWindow(page)).titleFont).toBe('20px/800/uppercase');
    await page.setViewportSize({ width: 412, height: 915 });
    await expect.poll(async () => (await resultWindow(page)).titleFont).toBe('16px/600/none');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('case-strip')).toHaveAttribute('data-state', 'spun');
    await expect.poll(() => centredItem(page, 0)).toBe(res.results[0]!.item.id);
  });

  test('подарок (бесплатные открытия): квадрат 36 с числом в ряду с x1…x5, ниже ничего не сдвигается @mobile', async ({
    page,
    api,
    player,
    isMobile,
  }) => {
    test.skip(!isMobile, 'раскладка телефона');
    expect(player.balance).toBe(0); // гемов не хватает — типичный случай бонуса по промокоду у нового игрока
    const c = await api.cheapestCase('cs2');
    // Бесплатные открытия приходят только вошедшему, уже после загрузки страницы: подменяем их в ответе кейса.
    await page.route(new RegExp(`/api/v1/games/cs2/cases/${c.slug}$`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as CaseDetailDto;
      return route.fulfill({
        response,
        json: { ...body, availability: { ...body.availability, freeOpens: 12 } },
      });
    });
    await page.goto(`/cs2/case/${c.slug}`);
    const gift = page.getByTestId('case-open-bonus');
    await expect(gift).toBeVisible();
    await expect(gift).toHaveAccessibleName(/12/);
    const [x1, fast, box, open] = await Promise.all(
      ['case-count-1', 'case-fast', 'case-open-bonus', 'case-open'].map((id) =>
        page.getByTestId(id).boundingBox(),
      ),
    );
    near(box!.width, 36, 'подарок: ширина');
    near(box!.height, 36, 'подарок: высота');
    near(box!.y, x1!.y, 'подарок в ряду с x1');
    near(box!.x + box!.width, 348, 'подарок у правого поля');
    near(box!.x - (fast!.x + fast!.width), 3, '«Быстро» → подарок');
    near(fast!.y, x1!.y, '«Быстро» в ряду с x1');
    near(open!.y - (x1!.y + x1!.height), 12, 'ряд → кнопка открытия');

    // Число видно на самом квадрате — значок 12 в 3 от правого верхнего угла, а не только в имени кнопки.
    const badge = gift.getByText('12', { exact: true });
    await expect(badge).toBeVisible();
    const b = (await badge.boundingBox())!;
    near(b.height, 12, 'значок: высота');
    near(b.y - box!.y, 3, 'значок: от верха квадрата');
    near(box!.x + box!.width - (b.x + b.width), 3, 'значок: от правого края квадрата');
    // Подарок открывает кейс и без гемов — вместо красного «Недостаточно средств» видно число бонусных открытий;
    // о нехватке говорят красная кнопка и скрытый текст для читалок (в описании кнопки открытия).
    await expect(page.getByTestId('case-open')).toHaveAttribute('data-state', 'insufficient');
    const info = page.getByTestId('case-info');
    await expect(info).toHaveAttribute('data-tone', 'muted');
    await expect(info).toContainText('12 бесплатных открытий по бонусу');
    await expect(info.locator('.sr-only')).toHaveText('Недостаточно средств.');
    await expect(page.getByTestId('case-open')).toHaveAccessibleDescription(
      'Недостаточно средств. 12 бесплатных открытий по бонусу',
    );
  });
});
