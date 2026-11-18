/**
 * Системная настройка «уменьшить движение». CSS-анимации гасит правило в globals.css,
 * а рулетки и колесо крутятся через Web Animations API — их сокращаем здесь.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Короткий переход вместо прокрутки, мс. */
export const REDUCED_MOTION_MS = 250;
