import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { GameCookieSync } from '@/components/layout/game-switcher';
import { getPublicConfig } from '@/lib/server-api';

export default async function GameLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const config = await getPublicConfig();
  if (!config.games.some((g) => g.code === game)) notFound();
  return (
    <>
      <GameCookieSync game={game} />
      {children}
    </>
  );
}
