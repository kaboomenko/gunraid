import { formatGems, type ItemDetailDto } from '@gunraid/shared';
import { ArrowLeft, Check, X } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ItemBadges } from '@/components/items/item-tile';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { serverGetOrNull } from '@/lib/server-api';

async function load(game: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return serverGetOrNull<ItemDetailDto>(`/games/${game}/items/${id}`, { revalidate: 30 });
}

export async function generateMetadata({ params }: { params: Promise<{ game: string; id: string }> }): Promise<Metadata> {
  const { game, id } = await params;
  const item = await load(game, id);
  if (!item) return {};
  return {
    title: item.fullName,
    description: `${item.fullName} — ${item.rarity.name}, ${formatGems(item.price)} GEMS`,
    alternates: { canonical: `/${game}/items/${id}` },
    openGraph: { images: item.imageUrl ? [item.imageUrl] : undefined },
  };
}

export default async function ItemPage({ params }: { params: Promise<{ game: string; id: string }> }) {
  const { game, id } = await params;
  const item = await load(game, id);
  if (!item) notFound();
  const [t, tw] = await Promise.all([getTranslations('items'), getTranslations('wear')]);

  const rows: Array<[string, React.ReactNode]> = [
    [t('detailRarity'), <span key="r" style={{ color: item.rarity.color }}>{item.rarity.name}</span>],
    [t('detailType'), item.modelName ?? item.typeCode],
  ];
  if (item.collection) rows.push([t('detailCollection'), item.collection]);
  if (item.wear) rows.push([t('detailWear'), tw(item.wear)]);
  if (item.floatMin && item.floatMax) rows.push([t('detailFloat'), `${item.floatMin} – ${item.floatMax}`]);

  return (
    <div className="space-y-5">
      <Link href={`/${game}/items`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card
          cut="lg"
          className="relative grid min-h-[280px] place-items-center p-6"
          style={{ background: `radial-gradient(60% 60% at 50% 70%, ${item.rarity.color}33, transparent 70%)` }}
        >
          <div className="absolute left-4 top-4 flex gap-1.5">
            <ItemBadges item={item} stLabel={t('stattrakBadge')} svLabel={t('souvenirBadge')} />
          </div>
          {item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.fullName} className="max-h-72 w-full max-w-xl object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: item.rarity.color, boxShadow: `0 0 24px ${item.rarity.color}` }} />
        </Card>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold" style={{ color: item.rarity.color }}>
              {item.modelName}
            </div>
            <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{item.fullName}</h1>
          </div>
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm text-muted">{t('detailPrice')}</span>
            <GemAmount value={item.price} size="lg" className="text-accent" />
          </Card>
          <Card className="divide-y divide-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-dim">{k}</span>
                <span className="text-right font-semibold">{v}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-dim">{item.isWithdrawable ? t('withdrawable') : t('notWithdrawable')}</span>
              {item.isWithdrawable ? <Check size={18} className="text-accent" /> : <X size={18} className="text-danger" />}
            </div>
          </Card>
        </div>
      </div>
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase">{t('inCases')}</h2>
        {item.cases.length ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {item.cases.map((c) => (
              <Link key={c.slug} href={`/${game}/case/${c.slug}`} className="cut block p-3 text-center text-sm hover:-translate-y-0.5">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-dim">{t('chance', { chance: c.chance })}</div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState text={t('inCasesEmpty')} />
        )}
      </section>
    </div>
  );
}
