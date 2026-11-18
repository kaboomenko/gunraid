'use client';

import { useParams } from 'next/navigation';
import { useConfig } from './config';

/** Код игры из URL (/standoff2/…), иначе — игра по умолчанию. */
export function useGameCode(): string {
  const params = useParams<{ game?: string }>();
  const config = useConfig();
  const code = typeof params?.game === 'string' ? params.game : undefined;
  return code && config.games.some((g) => g.code === code) ? code : config.defaultGame;
}

export function useGame() {
  const config = useConfig();
  const code = useGameCode();
  return config.games.find((g) => g.code === code) ?? config.games[0] ?? null;
}

export function gamePath(game: string, sub = ''): string {
  return `/${game}${sub}`;
}

/** /standoff2/upgrade → /cs2/upgrade (страницы, не зависящие от конкретной сущности). */
export function switchGamePath(pathname: string, to: string, known: string[]): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && known.includes(parts[0])) {
    const section = parts[1];
    // Страницы конкретных сущностей (кейс, предмет, баттл, игрок) в другой игре не существуют.
    const keepDeep = new Set(['upgrade', 'contract', 'battles', 'bonuses', 'leaderboard', 'profile', 'items']);
    if (!section) return `/${to}`;
    if (parts.length > 2 || !keepDeep.has(section)) return `/${to}${keepDeep.has(section) ? `/${section}` : ''}`;
    return `/${to}/${section}`;
  }
  return `/${to}`;
}
