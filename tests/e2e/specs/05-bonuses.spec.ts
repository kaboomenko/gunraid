import { expect, expectOk, test } from '../fixtures';

test.describe('Бонусы', () => {
  test('промокод на гемы активируется один раз', async ({ page, api, player }) => {
    expect(player.balance).toBe(0);
    await page.goto('/cs2/bonuses');
    await page.getByTestId('promo-input').fill('NEWBIE');
    await page.getByTestId('promo-activate').click();
    await expect(page.getByText(/^Начислено/).first()).toBeVisible();
    await expect.poll(async () => (await api.me()).balance).toBe(50);

    await page.getByTestId('promo-input').fill('NEWBIE');
    await page.getByTestId('promo-activate').click();
    await expect(page.getByText('Вы уже активировали этот промокод')).toBeVisible();
    expect((await api.me()).balance).toBe(50);
    await api.expectLedgerConsistent();
  });

  test('колесо: новый аккаунт ждёт сутки', async ({ page, player }) => {
    expect(player.id).toBeTruthy();
    await page.goto('/cs2/bonuses');
    await expect(page.getByTestId('wheel-spin')).toBeDisabled();
  });

  test('колесо: вращение по промокоду, созданному в админке @mobile', async ({
    page,
    api,
    adminApi,
  }) => {
    // Промокод на доп. вращение создаёт админ — без правки кода.
    const code = `E2ESPIN${Date.now().toString(36).toUpperCase()}`;
    const created = await adminApi.post('/admin/promo-codes', {
      code,
      type: 'wheel_spin',
      perUserLimit: 1,
      isActive: true,
    });
    expectOk(created);

    // Демо-игрок из сидов: аккаунт старше суток, пополнение — сейчас.
    await api.devLogin('player');
    await api.topUp(1);
    await page.goto('/cs2/bonuses');
    await page.getByTestId('promo-input').fill(code);
    await page.getByTestId('promo-activate').click();
    await expect(page.getByText('Дополнительное вращение колеса')).toBeVisible();

    const spin = page.getByTestId('wheel-spin');
    await expect(spin).toBeEnabled();
    await spin.click();
    await expect(page.getByTestId('wheel-result')).toBeVisible({ timeout: 30_000 });
    await api.expectLedgerConsistent();
  });
});
