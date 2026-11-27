'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Окно от 768 px — тот же порог, что `md:` в классах (48rem: при другом кегле браузера пороги не разойдутся). */
export const MD_UP = '(min-width: 48rem)';

/**
 * Раскладка телефона (окно < 768) — та же граница, что `max-md:` в классах и `@media (width < 48rem)` телефонных
 * блоков globals.css. По ней страница кейса в момент открытия решает, где крутится лента.
 */
export const PHONE_MEDIA = '(width < 48rem)';

/**
 * Совпадает ли медиазапрос; при смене (поворот, окно через порог) — перерисовка. На сервере и при
 * гидратации — fallback: разметка сервера окна не знает, поэтому для того, что видно только после
 * ответа API или действия игрока. Раскладку задаёт CSS (`md:`), не это.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
