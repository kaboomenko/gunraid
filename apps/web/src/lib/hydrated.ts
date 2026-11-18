'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * false во время SSR и гидратации (в том числе отложенной гидратации Suspense-границ),
 * true — после. Нужен, чтобы данные, известные только браузеру (сессия, localStorage),
 * не ломали гидратацию.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
