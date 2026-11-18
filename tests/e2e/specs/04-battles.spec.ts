import { expect, test } from '../fixtures';

test.describe('Кейс-баттлы', () => {
  test('баттл с ботами: создание, раунды, итог и проверка @mobile', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(10);
    await page.goto('/cs2/battles');
    await page.getByTestId('battle-create-link').click();
    await expect(page).toHaveURL(/\/cs2\/battles\/new$/);
    await page
      .getByTestId('battle-case-option')
      .first()
      .getByRole('button', { name: /Добавить/ })
      .last()
      .click();
    await page.getByTestId('battle-create-submit').click();
    await expect(page).toHaveURL(/\/cs2\/battles\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;

    await page.getByTestId('battle-bots').click();
    await expect(page.getByTestId('battle-result')).toBeVisible({ timeout: 90_000 });

    // Проверка честности: серверный seed баттла раскрыт сразу после завершения.
    await page.getByRole('link', { name: /Проверить честность/ }).click();
    await expect(page).toHaveURL(new RegExp(`/provably-fair\\?battle=${id}`));
    await expect(page.getByTestId('battle-proof')).toBeVisible();
    await expect(page.getByText('Совпадает с результатом на сайте')).toBeVisible();
    await api.expectLedgerConsistent();
  });
});
