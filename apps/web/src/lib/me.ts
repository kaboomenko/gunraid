'use client';

import type { MeDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';

export const ME_KEY = ['me'] as const;

/** Текущий пользователь; null — гость. */
export function useMe() {
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
