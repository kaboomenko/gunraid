import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/** Раскрыть server seed текущей пары: после этого результаты проверяются на странице. */
async function rotateSeed(page: Page) {
  await page.goto('/provably-fair');
  const done = page.waitForResponse(
    (r) => r.url().includes('/api/v1/fair/rotate') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Сменить пару/ }).click();
  expect((await done).ok()).toBe(true);
}

test.describe('Режимы и проверка честности', () => {
  test('апгрейд на гемы, проверка результата на странице Provably Fair', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(10);
    await page.goto('/standoff2/upgrade');
    await page.getByRole('tab', { name: 'Гемы' }).click();
    await page.locator('#upgrade-amount').fill('200');
    await page.getByRole('button', { name: 'x2', exact: true }).click();
    await page.getByTestId('upgrade-go').click();
    await expect(page.getByText(/Победа!|Не повезло/).first()).toBeVisible({ timeout: 30_000 });
    const href = await page
      .locator('a[href*="provably-fair?upgrade="]')
      .first()
      .getAttribute('href');
    expect(href).toBeTruthy();

    await rotateSeed(page);
    await page.goto(href!);
    await expect(page.getByText('Совпадает с результатом на сайте')).toBeVisible();
    await api.expectLedgerConsistent();
  });

  test('контракт из трёх предметов @mobile', async ({ page, api, player }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(10);
    const c = await api.cheapestCase('cs2');
    await api.openCase('cs2', c.slug, 3);
    await page.goto('/cs2/contract');
    const inv = page.getByTestId('contract-inventory');
    for (let i = 0; i < 3; i++) await inv.locator('button').nth(i).click();
    await page.getByTestId('contract-sign').click();
    const link = page.locator('a[href*="provably-fair?contract="]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute('href');

    const items = await api.inventory('cs2');
    expect(items.items.filter((i) => i.status === 'in_inventory')).toHaveLength(1);

    await rotateSeed(page);
    await page.goto(href!);
    await expect(page.getByText('Совпадает с результатом на сайте')).toBeVisible();
    await api.expectLedgerConsistent();
  });

  test('открытие кейса проверяется по nonce после смены пары', async ({ page, api, player }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('standoff2');
    const res = await api.openCase('standoff2', c.slug);
    const opening = res.results[0]!.openingId;
    await rotateSeed(page);
    await page.goto(`/provably-fair?opening=${opening}`);
    await expect(page.getByText('Совпадает с результатом на сайте')).toBeVisible();
  });
});
