import type { AdminSettingsDto } from '@gunraid/shared';
import { expect, expectOk, separateApi, test, uniqueNick } from '../fixtures';

test.describe('Админка', () => {
  test('комиссия апгрейда меняется в настройках без правки кода', async ({ page, api }) => {
    await api.devLogin('admin');
    const original = (await api.get<AdminSettingsDto>('/admin/settings')).body.values.upgrade;
    try {
      await page.goto('/admin/settings');
      const card = page.getByTestId('settings-upgrade');
      await card.locator('#upgrade-commission').fill('0.12');
      await card.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByText('Сохранено')).toBeVisible();
      await expect
        .poll(async () => (await api.get<{ commission: number }>('/games/cs2/upgrade/config')).body)
        .toMatchObject({ commission: 0.12 });
    } finally {
      await api.send('PUT', '/admin/settings/upgrade', original);
    }
  });

  test('редактор кейса: живой RTP и проверка суммы шансов', async ({ page, api }) => {
    await api.devLogin('admin');
    await page.goto('/admin/cases');
    // Строки появляются после загрузки списка (до этого — строка-заглушка).
    await page.locator('tbody tr', { hasText: /\d/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/cases\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('admin-case-rtp')).toBeVisible();
    await expect(page.getByText('ровно 100 %')).toBeVisible();
    const save = page.getByTestId('admin-case-contents-save');
    await page.getByRole('textbox', { name: 'Шанс, %' }).first().fill('0.5');
    await expect(page.getByText('должно быть ровно 100 %')).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Нормировать до 100 %' }).click();
    await expect(page.getByText('ровно 100 %')).toBeVisible();
    // Изменения не сохраняем — сиды остаются как есть.
  });

  test('промокод из админки работает у игрока', async ({ page, api, browser, baseURL }) => {
    await api.devLogin('admin');
    const code = `E2E${Date.now().toString(36).toUpperCase()}`;
    await page.goto('/admin/bonuses');
    await page.getByRole('tab', { name: 'Промокоды' }).click();
    await page.locator('#p-code').fill(code);
    await page.getByRole('textbox', { name: 'Гемы' }).first().fill('25');
    await page.getByTestId('admin-promo-save').click();
    await expect(page.getByText(code).first()).toBeVisible();

    const other = await separateApi(browser, baseURL);
    try {
      await other.api.devLogin('player', uniqueNick('promo'));
      const r = await other.api.post('/promo/activate', { code });
      expectOk(r);
      expect((await other.api.me()).balance).toBe(25);
    } finally {
      await other.close();
    }
  });

  test('ручная корректировка баланса с причиной попадает в аудит', async ({
    page,
    api,
    browser,
    baseURL,
  }) => {
    const other = await separateApi(browser, baseURL);
    const target = await other.api.devLogin('player', uniqueNick('adj'));
    await api.devLogin('admin');
    await page.goto(`/admin/users/${target.id}`);
    await page.getByTestId('admin-adjust-amount').fill('123');
    const submit = page.getByTestId('admin-adjust-submit');
    await expect(submit).toBeDisabled(); // причина обязательна
    await page.getByTestId('admin-adjust-reason').fill('e2e: компенсация');
    await submit.click();
    await expect.poll(async () => (await other.api.me()).balance).toBe(123);
    await other.api.expectLedgerConsistent();
    await other.close();

    const audit = await api.get<{ items: Array<{ action: string; entityId: string | null }> }>(
      `/admin/audit?entityId=${target.id}`,
    );
    expect(audit.body.items.some((a) => a.entityId === target.id)).toBe(true);
  });

  test('роли: support видит пользователей и выводы, но не настройки', async ({ page, api }) => {
    await api.devLogin('support');
    expect((await api.get('/admin/users?q=Dev')).status).toBe(200);
    expect((await api.get('/admin/withdrawals')).status).toBe(200);
    expect((await api.get('/admin/settings')).status).toBe(403);
    expect((await api.get('/admin/ledger/reconciliation')).status).toBe(403);
    await page.goto('/admin/withdrawals');
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('игрок не попадает в админку', async ({ page, player }) => {
    expect(player.role).toBe('user');
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
  });
});
