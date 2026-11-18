import { ArrowRight, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { GameIcon } from '@/components/ui/game-icon';

export async function Hero({ game, gameName, shortName }: { game: string; gameName: string; shortName: string }) {
  const t = await getTranslations('home');
  return (
    <section className="cut cut-xl stripes relative overflow-hidden [--cut-bg:var(--color-surface-1)]">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(198,255,0,0.22), transparent 65%)' }}
        aria-hidden="true"
      />
      <div className="relative grid items-center gap-6 px-5 py-8 sm:px-10 sm:py-12 md:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
            <GameIcon shortName={shortName} size="sm" />
            {t('heroKicker', { game: gameName })}
          </div>
          <h1 className="font-display-oblique text-3xl font-extrabold uppercase leading-[1.05] sm:text-5xl">
            {t('heroTitle')}
          </h1>
          <p className="max-w-xl text-sm text-muted sm:text-base">{t('heroText', { game: gameName })}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={`/${game}#cases`}>
                {t('heroCta')} <ArrowRight size={18} />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/provably-fair">
                <ShieldCheck size={18} /> {t('heroSecondary')}
              </Link>
            </Button>
          </div>
        </div>
        <div className="relative hidden justify-center md:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/emblem.svg"
            alt=""
            className="h-64 w-auto drop-shadow-[0_0_60px_rgba(198,255,0,0.35)] lg:h-72"
          />
        </div>
      </div>
    </section>
  );
}
