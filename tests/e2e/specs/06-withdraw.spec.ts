import type { AdminWithdrawalDto, WithdrawalDto } from '@gunraid/shared';
import { expect, expectOk, test } from '../fixtures';

const TRADE_URL = 'https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=E2eTok3n';

test.describe('Вывод предметов (заглушки провайдеров)', () => {
  test('CS2: заявка игрока, одобрение оператором, отмена сделки возвращает предмет', async ({
    page,
    api,
    adminApi,
  }) => {
    // Демо-игрок: первое пополнение старше суток (сиды), trade-ссылка указана.
    await api.devLogin('player');
    expectOk(await api.send('PUT', '/me/games/cs2/profile', { tradeUrl: TRADE_URL }));
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await api.openCase('cs2', c.slug, 3);

    await page.goto('/cs2/profile?tab=inventory');
    await page.getByTestId('withdraw-open').first().click();
    await expect(page.getByRole('dialog')).toContainText('выводятся только предметы');
    const created = page.waitForResponse(
      (r) => /\/api\/v1\/games\/cs2\/withdrawals$/.test(r.url()) && r.request().method() === 'POST',
    );
    await page.getByTestId('withdraw-submit').click();
    const res = await created;
    expect(res.ok()).toBe(true);
    const w = (await res.json()) as WithdrawalDto;
    expect(w.status).toBe('pending_review');

    await page.goto('/cs2/profile?tab=withdrawals');
    await expect(page.getByTestId('withdrawals-panel')).toContainText('На проверке');

    // Оператор: одобрить → (заглушка маркета) обмен отправлен/принят → отмена сделки.
    const approve = await adminApi.post<AdminWithdrawalDto>(`/admin/withdrawals/${w.id}/approve`);
    expect(approve.body.status).toBe('purchasing');
    for (const event of ['trade_sent', 'trade_accepted', 'reverse']) {
      const r = await adminApi.post<AdminWithdrawalDto>(`/admin/withdrawals/${w.id}/simulate`, {
        event,
      });
      expectOk(r);
    }
    const final = (await api.get<WithdrawalDto>(`/withdrawals/${w.id}`)).body;
    expect(final.status).toBe('reversed');
    expect(final.events.map((e) => e.toStatus)).toEqual([
      'pending_review',
      'purchasing',
      'trade_sent',
      'trade_accepted',
      'reversed',
    ]);
    await page.reload();
    await expect(page.getByTestId('withdrawals-panel')).toContainText('Сделка отменена');
  });

  test('гемы вывести нельзя: новый аккаунт видит условия вывода', async ({ page, api, player }) => {
    expect(player.id).toBeTruthy();
    await api.topUp(5);
    const c = await api.cheapestCase('cs2');
    await api.openCase('cs2', c.slug);
    await page.goto('/cs2/profile?tab=inventory');
    await page.getByTestId('withdraw-open').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Условия вывода');
    await expect(page.getByTestId('withdraw-submit')).toBeDisabled();
  });
});
