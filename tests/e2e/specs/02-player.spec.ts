import type { DepositDto, MeDto } from '@gunraid/shared';
import { expect, headerBalance, test, uniqueNick } from '../fixtures';

test.describe('Игрок: вход, пополнение, кейсы', () => {
  test('вход через окно входа и выход', async ({ page, api }) => {
    await page.goto('/cs2');
    await page.getByTestId('login-button').click();
    await page.getByTestId('dev-login-player').click();
    const gate = page.getByTestId('adult-confirm');
    if (await gate.isVisible().catch(() => false)) {
      await page.locator('#adult-confirm').click();
      await gate.click();
    }
    await expect(page.getByTestId('user-menu')).toBeVisible();
    expect((await api.me()).nickname).toBeTruthy();

    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await expect(page.getByTestId('login-button')).toBeVisible();
    expect((await api.get('/me')).status).toBe(401);
  });

  test('новый аккаунт подтверждает 18+ @mobile', async ({ page, api }) => {
    await api.devLogin('player', uniqueNick('age'), { confirmAge: false });
    await page.goto('/standoff2');
    const confirm = page.getByTestId('adult-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeDisabled();
    await page.locator('#adult-confirm').click();
    await confirm.click();
    await expect(confirm).toBeHidden();
    expect((await api.me()).adultConfirmed).toBe(true);
  });

  test('тестовое пополнение через окно оплаты @mobile', async ({ page, api, player }) => {
    expect(player.balance).toBe(0);
    await page.goto('/cs2');
    await page.getByTestId('deposit-open').click();
    const dialog = page.getByRole('dialog');
    // Курс всегда на виду, гемы показываются до оплаты.
    await expect(dialog).toContainText('100 гемов = $1');
    await expect(dialog.getByText('Будет начислено')).toBeVisible();
    const pay = page.getByTestId('deposit-pay');
    await expect(pay).toBeEnabled();
    await pay.click();

    await expect(page).toHaveURL(/\/pay\/mock\/[0-9a-f-]{36}$/);
    await page.getByTestId('mock-pay-success').click();
    await expect(page.getByText('Оплата прошла — гемы зачислены')).toBeVisible();

    const id = page.url().split('/').pop()!;
    const dep = (await api.get<DepositDto>(`/deposits/${id}`)).body;
    expect(dep.status).toBe('succeeded');
    const credited = dep.gemsAmount + dep.bonusGems;
    expect(credited).toBeGreaterThan(0);
    await expect.poll(() => headerBalance(page)).toBe(credited);
    expect((await api.get<MeDto>('/me')).body.balance).toBe(credited);
    await api.expectLedgerConsistent();
  });

  test('открытие кейса и продажа дропа, баланс сходится с ledger @mobile', async ({
    page,
    api,
    player,
  }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await page.getByTestId('case-open').first().click();
    const sellAll = page.getByTestId('result-sell-all');
    await expect(sellAll).toBeVisible({ timeout: 30_000 });
    const inv = await api.inventory('cs2');
    expect(inv.items.filter((i) => i.status === 'in_inventory')).toHaveLength(1);
    const afterOpen = (await api.me()).balance;

    await sellAll.click();
    await expect.poll(async () => (await api.me()).balance).toBeGreaterThan(afterOpen);
    const after = await api.inventory('cs2');
    expect(after.items.filter((i) => i.status === 'in_inventory')).toHaveLength(0);
    await api.expectLedgerConsistent();
  });

  test('продажа из инвентаря в профиле', async ({ page, api, player }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('standoff2');
    await api.openCase('standoff2', c.slug);
    const before = (await api.me()).balance;
    await page.goto('/standoff2/profile?tab=inventory');
    await page.getByRole('button', { name: 'Продать', exact: true }).first().click();
    await page.getByTestId('confirm-sell').click();
    await expect.poll(async () => (await api.me()).balance).toBeGreaterThan(before);
    await api.expectLedgerConsistent();
  });
});
