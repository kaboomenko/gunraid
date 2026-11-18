import type { LeaderboardsDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view';
import { SectionTitle } from '@/components/ui/card';
import { getPublicConfig, serverGet } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('leaderboard'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return {
    title: t('metaTitle', { game: name }),
    description: t('metaDescription', { game: name }),
    alternates: { canonical: `/${game}/leaderboard` },
  };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, initial] = await Promise.all([
    getTranslations('leaderboard'),
    serverGet<LeaderboardsDto>(`/games/${game}/leaderboards`, { revalidate: 0 }),
  ]);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="max-w-2xl text-sm text-muted">{t('lead')}</p>
      </div>
      <LeaderboardView game={game} initial={initial} />
    </div>
  );
}
