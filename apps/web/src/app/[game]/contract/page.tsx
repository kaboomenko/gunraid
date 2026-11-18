import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContractView } from '@/components/modes/contract-view';
import { SectionTitle } from '@/components/ui/card';
import { getPublicConfig } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('contract'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return { title: t('metaTitle', { game: name }), alternates: { canonical: `/${game}/contract` } };
}

export default async function ContractPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const t = await getTranslations('contract');
  return (
    <div className="space-y-4">
      <SectionTitle>{t('title')}</SectionTitle>
      <ContractView game={game} />
    </div>
  );
}
