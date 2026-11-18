'use client';

import type { PublicConfigDto } from '@gunraid/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/toast';
import { ConfigProvider } from '@/lib/config';
import { usePrefs } from '@/lib/store';

export function Providers({ config, children }: { config: PublicConfigDto; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } },
      }),
  );
  useEffect(() => {
    void usePrefs.persist.rehydrate();
    // Маркер для e2e: интерфейс гидратирован и реагирует на ввод.
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return (
    <ConfigProvider value={config}>
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ConfigProvider>
  );
}
