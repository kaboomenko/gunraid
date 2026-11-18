'use client';

import type {
  DepositDto,
  InventoryPageDto,
  InventorySort,
  MeDto,
  PageDto,
  PaymentMethodsDto,
  ProfileStatsDto,
  TransactionDto,
  UserItemDto,
} from '@gunraid/shared';
import { WS_EVENTS, type BalanceUpdatePayload } from '@gunraid/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { ME_KEY } from './me';
import { useSocketEvent } from './socket';

export const qk = {
  inventory: (game: string, sort: string) => ['inventory', game, sort] as const,
  stats: (game: string) => ['stats', game] as const,
  transactions: ['transactions'] as const,
  deposits: ['deposits'] as const,
  drops: (game: string) => ['drops', game] as const,
  methods: ['payment-methods'] as const,
};

export function useInventory(game: string, sort: InventorySort, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.inventory(game, sort),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<InventoryPageDto>(
        `/games/${game}/inventory?sort=${sort}&page=${pageParam}&pageSize=60`,
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

export function useProfileStats(game: string, enabled = true) {
  return useQuery({
    queryKey: qk.stats(game),
    enabled,
    queryFn: () => api.get<ProfileStatsDto>(`/me/stats?game=${game}`),
  });
}

function cursorPage<T>(
  key: readonly unknown[],
  path: (cursor: string | null) => string,
  enabled = true,
) {
  return {
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.get<PageDto<T>>(path(pageParam)),
    getNextPageParam: (last: PageDto<T>) => last.nextCursor,
  };
}

export function useTransactions(enabled = true) {
  return useInfiniteQuery(
    cursorPage<TransactionDto>(
      qk.transactions,
      (c) => `/me/transactions${c ? `?cursor=${c}` : ''}`,
      enabled,
    ),
  );
}

export function useDeposits(enabled = true) {
  return useInfiniteQuery(
    cursorPage<DepositDto>(
      qk.deposits,
      (c) => `/deposits${c ? `?cursor=${encodeURIComponent(c)}` : ''}`,
      enabled,
    ),
  );
}

export function useDrops(game: string, enabled = true) {
  return useInfiniteQuery(
    cursorPage<UserItemDto>(
      qk.drops(game),
      (c) => `/me/history/drops?game=${game}${c ? `&cursor=${encodeURIComponent(c)}` : ''}`,
      enabled,
    ),
  );
}

export function usePaymentMethods(enabled = true) {
  return useQuery({
    queryKey: qk.methods,
    enabled,
    queryFn: () => api.get<PaymentMethodsDto>('/payments/methods'),
  });
}

/** Обновления баланса по WebSocket → кэш профиля. */
export function useBalanceSync() {
  const qc = useQueryClient();
  useSocketEvent<BalanceUpdatePayload>(WS_EVENTS.balanceUpdate, (p) => {
    qc.setQueryData<MeDto | null>(ME_KEY, (me) => (me ? { ...me, balance: p.balance } : me));
    void qc.invalidateQueries({ queryKey: qk.transactions });
  });
  // Предметы выданы в фоне (например, выигрыш баттла) — обновить инвентарь и историю.
  useSocketEvent(WS_EVENTS.inventoryUpdate, () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['drops'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  });
}

/** После операций с балансом и инвентарём. */
export function useInvalidateWallet() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ME_KEY });
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
    void qc.invalidateQueries({ queryKey: qk.transactions });
    void qc.invalidateQueries({ queryKey: ['drops'] });
  };
}
