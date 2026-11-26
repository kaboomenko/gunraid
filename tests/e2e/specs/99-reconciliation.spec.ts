import type { AdminCargoReconciliationDto } from '@gunraid/shared';
import { expect, test } from '../fixtures';

/** После всех сценариев: баланс каждого кошелька = сумма записей ledger, места грузов сходятся с ledger. */
test('сверка всех балансов с ledger', async ({ adminApi }) => {
  const r = await adminApi.get<{ ok: boolean; mismatches: unknown[] }>(
    '/admin/ledger/reconciliation',
  );
  expect(r.status).toBe(200);
  expect(r.body.mismatches).toEqual([]);
  expect(r.body.ok).toBe(true);

  // Грузы (D39): у каждой платной покупки — своя запись списания, возвраты — только у раундов с возвратом.
  const cargo = await adminApi.get<AdminCargoReconciliationDto>('/admin/cargo-reconciliation');
  expect(cargo.status).toBe(200);
  expect(cargo.body.mismatches).toEqual([]);
  expect(cargo.body.ok).toBe(true);
});
