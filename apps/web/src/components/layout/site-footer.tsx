import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FooterGameLinks } from './footer-game-links';

/** Документы — два столбца справа от разделов сайта, порядок как в макете. */
const DOCS = [
  [
    { href: '/legal/terms', key: 'offer' },
    { href: '/legal/privacy', key: 'privacy' },
    { href: '/legal/payments', key: 'payments' },
    { href: '/legal/refunds', key: 'refunds' },
  ],
  [
    { href: '/legal/cookies', key: 'cookies' },
    { href: '/legal/bonuses', key: 'bonusRules' },
    { href: '/legal/giveaways', key: 'giveaways' },
    { href: '/provably-fair', key: 'fair' },
  ],
] as const;

/**
 * Футер по макету: логотип, под ним описание, справа разделы сайта и документы, ниже разделитель
 * и копирайт. Раскладка и размеры — классы .site-footer* в globals.css.
 */
export async function SiteFooter() {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();
  const [docs, docsEnd] = DOCS;
  return (
    <footer className="site-footer" data-testid="site-footer">
      <div className="site-footer__top">
        <span className="logo-mask site-footer__logo" role="img" aria-label={t('logo')} />
        <p className="site-footer__about">{t('about')}</p>
        <div className="site-footer__mid">
          <FooterGameLinks />
          <ul className="site-footer__list">
            {docs.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className="site-footer__link">
                  {t(d.key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <ul className="site-footer__list site-footer__end">
          {docsEnd.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="site-footer__link">
                {t(d.key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="site-footer__rule" aria-hidden="true" />
      <p className="site-footer__copy">{t('rights', { year })}</p>
    </footer>
  );
}
