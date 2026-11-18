import type { BattleDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { BattleRoom } from '@/components/battles/battle-room';
import { serverGetOrNull } from '@/lib/server-api';

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return serverGetOrNull<BattleDto>(`/battles/${id}`, { revalidate: 0 });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [b, t] = await Promise.all([load(id), getTranslations('battles')]);
  if (!b) return {};
  return {
    title: `${t('title')} · ${t(`formats.${b.format}`)} · ${t(`modes.${b.mode}`)}`,
    robots: { index: false },
  };
}

export default async function BattlePage({
  params,
}: {
  params: Promise<{ game: string; id: string }>;
}) {
  const { game, id } = await params;
  const battle = await load(id);
  if (!battle) notFound();
  if (battle.game !== game) redirect(`/${battle.game}/battles/${battle.id}`);
  return <BattleRoom key={battle.id} initial={battle} />;
}
