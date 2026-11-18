import type { BattleConfigDto, BattleListDto } from '@gunraid/shared';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BattleList } from '@/components/battles/battle-list';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { getPublicConfig, serverGet } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('battles'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return {
    title: t('metaTitle', { game: name }),
    description: t('metaDescription', { game: name }),
    alternates: { canonical: `/${game}/battles` },
  };
}

export default async function BattlesPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, initial, config] = await Promise.all([
    getTranslations('battles'),
    serverGet<BattleListDto>(`/games/${game}/battles?status=active&pageSize=50`, {
      revalidate: 0,
    }),
    serverGet<BattleConfigDto>(`/games/${game}/battles/config`, { revalidate: 30 }),
  ]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <SectionTitle>{t('title')}</SectionTitle>
          <p className="max-w-2xl text-sm text-muted">{t('lead')}</p>
        </div>
        <Button asChild size="lg">
          <Link href={`/${game}/battles/new`} data-testid="battle-create-link">
            <Plus size={18} /> {t('createButton')}
          </Link>
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <BattleList game={game} initial={initial} />
        <Card className="space-y-3 p-4 text-sm">
          <h2 className="font-display text-base font-bold uppercase">{t('rulesTitle')}</h2>
          <ol className="list-decimal space-y-2 pl-4 text-muted marker:text-accent">
            <li>{t('rules.r1')}</li>
            <li>{t('rules.r2')}</li>
            <li>{t('rules.r3')}</li>
            <li>{t('rules.r4', { minutes: config.lobbyTimeoutMinutes })}</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
