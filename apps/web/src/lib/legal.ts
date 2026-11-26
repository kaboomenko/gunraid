/**
 * Правовые документы (/legal/[slug]): порядок — как в футере, «Правила сайта», «18+» и «Ответственная
 * игра» — в конце (их нет в футере макета, они в общем списке внизу каждой правовой страницы). Один
 * список для страницы, карты сайта и e2e.
 */
export const LEGAL_SLUGS = [
  'terms',
  'privacy',
  'payments',
  'refunds',
  'cookies',
  'bonuses',
  'giveaways',
  'rules',
  'age',
  'responsible',
] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const isLegalSlug = (s: string): s is LegalSlug =>
  (LEGAL_SLUGS as readonly string[]).includes(s);
