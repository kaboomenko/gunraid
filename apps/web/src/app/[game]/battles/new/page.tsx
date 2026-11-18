import type { BattleCaseOptionDto, BattleConfigDto } from '@gunraid/shared';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BattleCreate } from '@/components/battles/battle-create';
import { SectionTitle } from '@/components/ui/card';
import { getPublicConfig, serverGet } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('battles.createPage'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return { title: t('metaTitle', { game: name }), robots: { index: false } };
}

export default async function NewBattlePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, cases, config] = await Promise.all([
    getTranslations('battles'),
    serverGet<BattleCaseOptionDto[]>(`/games/${game}/battles/cases`, { revalidate: 30 }),
    serverGet<BattleConfigDto>(`/games/${game}/battles/config`, { revalidate: 30 }),
  ]);
  return (
    <div className="space-y-4">
      <Link
        href={`/${game}/battles`}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <SectionTitle>{t('createPage.title')}</SectionTitle>
      <BattleCreate game={game} cases={cases} config={config} />
    </div>
  );
}
