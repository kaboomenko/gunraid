import { expect, test } from '../fixtures';

/** После всех сценариев: баланс каждого кошелька = сумма записей ledger. */
test('сверка всех балансов с ledger', async ({ adminApi }) => {
  const r = await adminApi.get<{ ok: boolean; mismatches: unknown[] }>(
    '/admin/ledger/reconciliation',
  );
  expect(r.status).toBe(200);
  expect(r.body.mismatches).toEqual([]);
  expect(r.body.ok).toBe(true);
});
