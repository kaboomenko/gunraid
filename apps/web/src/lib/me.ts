'use client';

import type { MeDto } from '@gunraid/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiError, api } from './api';
import { useHydrated } from './hydrated';

export const ME_KEY = ['me'] as const;

/**
 * Текущий пользователь; null — гость.
 * Пока идёт гидратация, возвращает состояние «загружается» — как при SSR, где сессии нет:
 * иначе Suspense-границы, гидратируемые позже, видят уже загруженного пользователя и расходятся с HTML.
 */
export function useMe(): UseQueryResult<MeDto | null> {
  const hydrated = useHydrated();
  const query = useMeQuery();
  if (hydrated) return query;
  return {
    ...query,
    data: undefined,
    error: null,
    status: 'pending',
    fetchStatus: 'fetching',
    isPending: true,
    isLoading: true,
    isFetching: true,
    isSuccess: false,
    isError: false,
    isLoadingError: false,
    isRefetchError: false,
    isPlaceholderData: false,
  } as UseQueryResult<MeDto | null>;
}

function useMeQuery() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<MeDto | null> => {
      try {
        return await api.get<MeDto>('/me');
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: MeDto | null) => qc.setQueryData(ME_KEY, me);
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}
