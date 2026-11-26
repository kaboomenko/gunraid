'use client';

import { useRef, type RefObject } from 'react';

/** Фокус можно вернуть: элемент ещё на странице и не выключен. */
function canFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  return Boolean(el?.isConnected && !el.matches(':disabled'));
}

/**
 * Возврат фокуса после закрытия окна Radix, открытого кодом (без Dialog.Trigger). Radix возвращает
 * фокус только на Trigger, а без него фокус падает на <body> — с клавиатуры приходится заново идти
 * с начала страницы. Запоминаем, где был фокус в момент открытия, и возвращаем туда; если того
 * элемента уже нет (или фокуса не было) — на запасной `fallback`.
 * Обработчики — в onOpenAutoFocus / onCloseAutoFocus у Dialog.Content.
 */
export function useReturnFocus(fallback?: RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      // Вызывается до того, как фокус уйдёт в окно: activeElement — ещё элемент страницы.
      const el = document.activeElement;
      opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (e: Event) => {
      const target = [opener.current, fallback?.current].find(canFocus);
      opener.current = null;
      if (!target) return;
      e.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
}
