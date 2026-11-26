import type { CaseCardDto, CaseDetailDto, HomeDto } from '@gunraid/shared';
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
