'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { ChevronDownIcon, SoundOffIcon, SoundOnIcon } from '@/components/icons/design-icons';
import { cn } from '@/lib/cn';
import { usePrefToggles } from '@/lib/prefs';
import { usePrefs, usePrefsHydrated } from '@/lib/store';
import { GameMenuContent, useGameSelect } from './game-switcher';
import { LiveFeed } from './live-feed';

/** «CS2» → «CS 2», как в макете. */
function spacedShortName(shortName: string): string {
  return shortName.replace(/(\D)(\d)/, '$1 $2');
}

const TILE = 'h-[72px] rounded-[12px] p-6 transition-[filter] duration-150 hover:brightness-125';

/**
 * Выбор игры: 249×72, текст слева, стрелка справа (#B7FF00), градиент #282F1E → #181821;
 * все углы 12 (он внутри верхнего блока). Открытое меню — стрелка вверх, панель на 6px ниже
 * (GameMenuContent).
 */
function GameSelect() {
  const t = useTranslations('header');
  const { current, games, select } = useGameSelect();
  if (!current) return <div className={cn(TILE, 'w-[249px] bg-surface-1')} />;
  return (
    <Dropdown>
      <DropdownTrigger
        className={cn(
          TILE,
          'group flex w-[249px] items-center justify-between bg-[linear-gradient(90deg,#282f1e,#181821)] text-lime',
        )}
        aria-label={t('selectGame')}
        data-testid="game-select"
      >
        <span className="text-[24px] font-semibold">{spacedShortName(current.shortName)}</span>
        <ChevronDownIcon className="transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </DropdownTrigger>
      <GameMenuContent games={games} current={current.code} onSelect={select} />
    </Dropdown>
  );
}

const LANGUAGES = [{ code: 'ru', short: 'RU', flag: '/design/flags/ru.svg' }] as const;

/**
 * Выбор языка: флаг 28×20 + код DemiBold 24 + стрелка, отступы 24 и 12 → 158×72; углы 12, но на
 * планшете (шапка там своя, наверху) его левый нижний угол — внешний угол верхнего блока, 36.
 */
function LanguageSelect() {
  const t = useTranslations('topBar');
  const locale = useLocale();
  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];
  return (
    <Dropdown>
      <DropdownTrigger
        className={cn(
          TILE,
          'flex items-center gap-3 rounded-bl-[36px] bg-surface-1 text-text lg:rounded-bl-[12px]',
        )}
        aria-label={t('language')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.flag} alt="" width={28} height={20} className="shrink-0" />
        <span className="text-[24px] font-semibold">{current.short}</span>
        <ChevronDownIcon />
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>{t('language')}</DropdownLabel>
        {LANGUAGES.map((l) => (
          <DropdownItem key={l.code}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.flag} alt="" width={28} height={20} />
            <span className="flex-1 font-semibold text-text">{t(`languages.${l.code}`)}</span>
            {l.code === current.code && <Check size={16} className="text-accent" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

/** Звуки сайта: 85×72, иконка белая 30%. */
function SoundToggle() {
  const t = useTranslations('topBar');
  const hydrated = usePrefsHydrated();
  const sound = usePrefs((s) => s.sound);
  const { setSound } = usePrefToggles();
  const on = !hydrated || sound;
  return (
    <button
      type="button"
      className={cn(
        TILE,
        'grid flex-1 place-items-center bg-surface-1 text-white/30 hover:text-white/60',
      )}
      onClick={() => setSound(!sound)}
      aria-pressed={on}
      aria-label={on ? t('soundOn') : t('soundOff')}
      data-testid="sound-toggle"
    >
      {on ? <SoundOnIcon /> : <SoundOffIcon />}
    </button>
  );
}

/**
 * Ряд под промо-полосой: слева выбор игры, языка и звука (249×150), справа лента
 * последних дропов до правого края экрана, поверх неё — плашка онлайна и затемнение.
 */
export function TopBar() {
  return (
    <div className="flex gap-[6px] md:-mr-6">
      <div className="hidden w-[249px] shrink-0 flex-col gap-[6px] md:flex">
        <GameSelect />
        <div className="flex gap-[6px]">
          <LanguageSelect />
          <SoundToggle />
        </div>
      </div>
      <LiveFeed />
    </div>
  );
}
