'use client';

import { COOKIES, type GameDto } from '@gunraid/shared';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useEffect } from 'react';
import { Dropdown, DropdownTrigger } from '@/components/ui/dropdown';
import { GameIcon } from '@/components/ui/game-icon';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { getCookie, setCookie } from '@/lib/cookies';
import { switchGamePath, useGame } from '@/lib/game';
import { useMe } from '@/lib/me';

/** Текущая игра, список игр и переключение (cookie, профиль, тот же раздел другой игры). */
export function useGameSelect() {
  const config = useConfig();
  const current = useGame();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  const select = (code: string) => {
    if (code === current?.code) return;
    setCookie(COOKIES.game, code, 60 * 60 * 24 * 365);
    if (me.data) void api.patch('/me/settings', { selectedGame: code }).catch(() => undefined);
    router.push(
      switchGamePath(
        pathname,
        code,
        config.games.map((g) => g.code),
      ),
    );
  };
  return { current, games: config.games, select };
}

/** Картинки игр по коду (36×36 в меню, файлы 108×108); для новой игры без картинки — монограмма. */
const GAME_ICONS: Record<string, string> = {
  standoff2: '/design/games/standoff2.webp',
  cs2: '/design/games/cs2.webp',
};

export function GameImage({ game, size = 36 }: { game: GameDto; size?: number }) {
  const src = GAME_ICONS[game.code];
  if (!src) return <GameIcon shortName={game.shortName} size="sm" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[6px]"
      draggable={false}
    />
  );
}

/**
 * Меню выбора игры (макет): панель #181821, поля 12, между строками 6, скругления 24, левый верхний — 6.
 * Строка: поля 6 (справа 12), картинка игры 36×36 (скругление 6), отступ 12, название DemiBold 24 белым капслоком,
 * скругление 12, фон #26262F, под курсором или клавиатурным фокусом — #3E3E50.
 */
export function GameMenuContent({
  games,
  current,
  onSelect,
}: {
  games: GameDto[];
  current: string;
  onSelect: (code: string) => void;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="gr-pop z-50 rounded-[24px] rounded-tl-[6px] bg-surface-1 p-3 shadow-[0_18px_48px_rgb(0_0_0/0.55)] outline-none"
      >
        <DropdownMenu.RadioGroup
          value={current}
          onValueChange={onSelect}
          className="flex flex-col gap-[6px]"
        >
          {games.map((g) => (
            <DropdownMenu.RadioItem
              key={g.code}
              value={g.code}
              aria-label={g.name}
              className={cn(
                'flex cursor-pointer select-none items-center gap-3 rounded-[12px] bg-[#26262f] py-[6px] pl-[6px] pr-3 outline-none transition-colors duration-100',
                'data-[highlighted]:bg-[#3e3e50]',
              )}
            >
              <GameImage game={g} />
              <span className="whitespace-nowrap text-[24px] font-semibold uppercase text-white">
                {g.name.replace(/-/g, ' ')}
              </span>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

/** Компактный переключатель игры (мобильная шапка); меню — то же, что на десктопе. */
export function GameSwitcher() {
  const t = useTranslations('header');
  const { current, games, select } = useGameSelect();

  if (!current) return null;
  return (
    <Dropdown>
      <DropdownTrigger
        className="group flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-surface-2 pl-1 pr-1.5 transition hover:bg-surface-3 sm:gap-2 sm:pr-2.5"
        aria-label={t('selectGame')}
      >
        <GameImage game={current} size={32} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold sm:inline">
          {current.name}
        </span>
        <ChevronDown
          size={16}
          className="text-dim transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </DropdownTrigger>
      <GameMenuContent games={games} current={current.code} onSelect={select} />
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
