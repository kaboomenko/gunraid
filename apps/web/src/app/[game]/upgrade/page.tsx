import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UpgradeView } from '@/components/modes/upgrade-view';
import { SectionTitle } from '@/components/ui/card';
import { getPublicConfig } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('upgrade'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return { title: t('metaTitle', { game: name }), alternates: { canonical: `/${game}/upgrade` } };
}

export default async function UpgradePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const t = await getTranslations('upgrade');
  return (
    <div className="space-y-4">
      <SectionTitle>{t('title')}</SectionTitle>
      <UpgradeView game={game} />
    </div>
  );
}
