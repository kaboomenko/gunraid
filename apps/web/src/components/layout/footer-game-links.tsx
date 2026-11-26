'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useGameCode } from '@/lib/game';

const ITEMS = [
  { key: 'cases', path: '' },
  { key: 'upgrade', path: '/upgrade' },
  { key: 'contract', path: '/contract' },
  { key: 'battles', path: '/battles' },
] as const;

/** Разделы сайта в футере: футер общий для всех страниц, а ссылки ведут в текущую игру. */
export function FooterGameLinks() {
  const t = useTranslations('nav');
  const game = useGameCode();
  return (
    <ul className="site-footer__list">
      {ITEMS.map((item) => (
        <li key={item.key}>
          <Link href={`/${game}${item.path}`} className="site-footer__link">
            {t(item.key)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
