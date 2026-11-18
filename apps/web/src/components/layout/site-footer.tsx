import { Send } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function SiteFooter({ supportUrl }: { supportUrl: string | null }) {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();
  const docs = [
    { href: '/legal/terms', label: t('terms') },
    { href: '/legal/privacy', label: t('privacy') },
    { href: '/legal/rules', label: t('rules') },
    { href: '/legal/age', label: t('adult') },
    { href: '/legal/responsible', label: t('responsible') },
  ];
  return (
    <footer className="mt-16 border-t border-line bg-surface-1/60 pb-[calc(var(--tabbar-h)+16px)] md:pb-0">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:px-5 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt="GunRaid" className="h-7 w-auto" />
          <p className="max-w-sm text-sm text-muted">{t('about')}</p>
          <div className="flex items-center gap-3">
            <span className="clip-cut grid h-9 w-11 place-items-center bg-danger font-display text-sm font-extrabold [--cut:6px]">
              18+
            </span>
            <p className="text-xs text-dim">{t('disclaimer')}</p>
          </div>
        </div>
        <div>
          <div className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-dim">
            {t('sections.site')}
          </div>
          <ul className="space-y-2 text-sm">
            <li>
              <Link className="text-muted hover:text-text" href="/items">
                {t('items')}
              </Link>
            </li>
            <li>
              <Link className="text-muted hover:text-text" href="/provably-fair">
                {t('fair')}
              </Link>
            </li>
            <li>
              <Link className="text-muted hover:text-text" href="/faq">
                {t('faq')}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-dim">
            {t('sections.docs')}
          </div>
          <ul className="space-y-2 text-sm">
            {docs.map((d) => (
              <li key={d.href}>
                <Link className="text-muted hover:text-text" href={d.href}>
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-dim">
            {t('sections.help')}
          </div>
          {supportUrl ? (
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="clip-cut inline-flex h-10 items-center gap-2 bg-surface-3 px-4 text-sm font-semibold transition hover:bg-line-strong [--cut:7px]"
            >
              <Send size={16} className="text-accent" /> {t('support')}
            </a>
          ) : (
            <Link className="text-sm text-muted hover:text-text" href="/faq">
              {t('faq')}
            </Link>
          )}
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-dim">
        {t('rights', { year })}
      </div>
    </footer>
  );
}
