'use client';

import { COOKIES } from '@gunraid/shared';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownTrigger } from '@/components/ui/dropdown';
import { GameIcon } from '@/components/ui/game-icon';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { getCookie, setCookie } from '@/lib/cookies';
import { switchGamePath, useGame } from '@/lib/game';
import { useMe } from '@/lib/me';

export function GameSwitcher() {
  const t = useTranslations('header');
  const config = useConfig();
  const current = useGame();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  const select = (code: string) => {
    if (code === current?.code) return;
    setCookie(COOKIES.game, code, 60 * 60 * 24 * 365);
    if (me.data) void api.patch('/me/settings', { selectedGame: code }).catch(() => undefined);
    router.push(switchGamePath(pathname, code, config.games.map((g) => g.code)));
  };

  if (!current) return null;
  return (
    <Dropdown>
      <DropdownTrigger
        className="clip-cut flex h-10 items-center gap-2 bg-surface-2 pl-1.5 pr-2.5 transition hover:bg-surface-3 [--cut:7px]"
        aria-label={t('selectGame')}
      >
        <GameIcon shortName={current.shortName} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold sm:inline">{current.name}</span>
        <ChevronDown size={16} className="text-dim" />
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>{t('games')}</DropdownLabel>
        {config.games.map((g) => (
          <DropdownItem key={g.code} onSelect={() => select(g.code)}>
            <GameIcon shortName={g.shortName} size="sm" />
            <span className="flex-1 font-semibold text-text">{g.name}</span>
            {g.code === current.code && <Check size={16} className="text-accent" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

/** Запоминает игру из URL в cookie (для редиректа с «/»). */
export function GameCookieSync({ game }: { game: string }) {
  useEffect(() => {
    if (getCookie(COOKIES.game) !== game) setCookie(COOKIES.game, game, 60 * 60 * 24 * 365);
  }, [game]);
  return null;
}
