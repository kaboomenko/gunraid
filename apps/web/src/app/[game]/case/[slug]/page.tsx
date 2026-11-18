import { formatGems, type CaseDetailDto } from '@gunraid/shared';
import { ArrowLeft, Clock, Crown } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaseOpener } from '@/components/cases/case-opener';
import { ItemTile } from '@/components/items/item-tile';
import { Badge } from '@/components/ui/badge';
import { SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { getPublicConfig, serverGetOrNull } from '@/lib/server-api';

async function load(game: string, slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGetOrNull<CaseDetailDto>(`/games/${game}/cases/${slug}`, { revalidate: 15 });
}

export async function generateMetadata({ params }: { params: Promise<{ game: string; slug: string }> }): Promise<Metadata> {
  const { game, slug } = await params;
  const [c, t, config] = await Promise.all([load(game, slug), getTranslations('case'), getPublicConfig()]);
  if (!c) return {};
  const gameName = config.games.find((g) => g.code === game)?.name ?? game;
  return {
    title: t('metaTitle', { name: c.name, game: gameName }),
    description: t('metaDescription', { name: c.name, game: gameName, price: formatGems(c.price) }),
    alternates: { canonical: `/${game}/case/${slug}` },
    openGraph: { images: c.imageUrl ? [c.imageUrl] : undefined },
  };
}

export default async function CasePage({ params }: { params: Promise<{ game: string; slug: string }> }) {
  const { game, slug } = await params;
  const c = await load(game, slug);
  if (!c) notFound();
  const [t, ti] = await Promise.all([getTranslations('case'), getTranslations('items')]);
  return (
    <div className="space-y-6">
      <Link href={`/${game}#cases`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <section
        className="cut cut-xl stripes relative overflow-hidden px-4 py-6 sm:px-8"
        style={{ background: `radial-gradient(60% 80% at 50% 0%, ${c.accentColor}26, transparent 70%)` }}
      >
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          {c.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.imageUrl} alt={c.name} className="h-28 w-28 object-contain drop-shadow-[0_16px_32px_rgba(0,0,0,0.6)] sm:h-36 sm:w-36" />
          )}
          <h1 className="font-display-oblique text-2xl font-extrabold uppercase sm:text-4xl">{c.name}</h1>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {c.kind === 'free' ? (
              <Badge tone="accent">{t('free')}</Badge>
            ) : (
              <GemAmount value={c.price} size="lg" className="text-accent" />
            )}
            {c.cooldownSeconds && (
              <Badge>
                <Clock size={12} /> {t('everyHours', { hours: Math.round(c.cooldownSeconds / 3600) })}
              </Badge>
            )}
            {c.minLevel && (
              <Badge tone="info">
                <Crown size={12} /> {t('fromLevel', { level: c.minLevel })}
              </Badge>
            )}
          </div>
        </div>
        <CaseOpener game={game} initial={c} />
      </section>

      <section>
        <SectionTitle>{t('contents')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {c.items.map((entry) => (
            <Link key={entry.item.id} href={`/${game}/items/${entry.item.id}`} className="relative block">
              <ItemTile item={entry.item} stLabel={ti('stattrakBadge')} svLabel={ti('souvenirBadge')} />
              <span className="clip-cut absolute right-2 top-2 bg-bg/80 px-2 py-0.5 text-[11px] font-bold text-text backdrop-blur [--cut:4px]">
                {t('chance', { chance: entry.chance })}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
