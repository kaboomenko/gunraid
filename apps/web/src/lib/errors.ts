'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiError } from './api';

/** Текст ошибки API по коду (errors.<CODE> в messages). */
export function useErrorMessage() {
  const t = useTranslations('errors');
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.code === 'NETWORK') return t('network');
        if (t.has(err.code)) return t(err.code);
      }
      return t('unknown');
    },
    [t],
  );
}
