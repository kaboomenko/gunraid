import type { WheelStateDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BonusesView } from '@/components/bonuses/bonuses-view';
import { SectionTitle } from '@/components/ui/card';
import { getPublicConfig, serverGet } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('bonuses'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return {
    title: t('metaTitle', { game: name }),
    description: t('metaDescription'),
    alternates: { canonical: `/${game}/bonuses` },
  };
}

export default async function BonusesPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, wheel] = await Promise.all([
    getTranslations('bonuses'),
    serverGet<WheelStateDto>(`/games/${game}/wheel`, { revalidate: 30 }),
  ]);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="max-w-2xl text-sm text-muted">{t('lead')}</p>
      </div>
      <BonusesView game={game} initialWheel={wheel} />
    </div>
  );
}
