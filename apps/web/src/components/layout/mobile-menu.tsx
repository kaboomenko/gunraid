'use client';

import type { MeDto } from '@gunraid/shared';
import {
  Backpack,
  Bell,
  Check,
  LogOut,
  Settings,
  Shield,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  LoginIcon,
  MenuIcon,
  SoundOffIcon,
  SoundOnIcon,
} from '@/components/icons/design-icons';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { LANGUAGES } from '@/lib/languages';
import { MD_UP } from '@/lib/media';
import { useSoundPref } from '@/lib/prefs';
import { useUi } from '@/lib/store';
import { GameImage, GameMenuContent, useGameSelect } from './game-switcher';
import { MENU_NAV, isActive } from './nav-items';
import { NotificationsList, useMarkAllRead, useNotificationsList } from './notifications-bell';
import { useLogout } from './user-menu';

/**
 * Строка шторки (шкала телефона 16 / 12 / 8): высота 36, поля 12, иконка 12 → 12 → Medium 12, скругление 6,
 * фон #26262F; под курсором или клавиатурным фокусом — #3E3E50.
 */
const ROW =
  'flex h-9 w-full items-center gap-3 rounded-[6px] bg-[#26262f] px-3 text-[12px] font-medium transition-colors hover:bg-[#3e3e50] focus-visible:bg-[#3e3e50]';
/**
 * Неактивная строка — белая 50 %, под курсором 80 %; активная — белая с лаймовой иконкой. Подписи строк — в span:
 * обрезка текста по прописным (text-box) действует на элемент, и подпись встаёт по центру строки, как в шапке.
 */
const ROW_IDLE = 'text-white/50 hover:text-white/80';

/**
 * Выпадающее меню в шторке — один вид со всеми меню телефона (как меню игры десктопа в мобильных размерах):
 * панель шириной с кнопку #181821, скругление 12 (левый верхний 3), поля 6, между пунктами 3; пункт 36 —
 * #26262F, скругление 6, поля 12, Medium 12.
 */
const MENU_PANEL =
  'gr-pop z-50 w-[var(--radix-dropdown-menu-trigger-width)] rounded-[12px] rounded-tl-[3px] bg-surface-1 p-[6px] shadow-[0_18px_48px_rgb(0_0_0/0.55)] outline-none';
const MENU_ITEM =
  'flex h-9 cursor-pointer select-none items-center gap-3 rounded-[6px] bg-[#26262f] px-3 text-[12px] font-medium text-white outline-none transition-colors duration-100 data-[highlighted]:bg-[#3e3e50]';

/**
 * Кнопка «Меню» шапки телефона и шторка с разделами сайта (макета шторки нет — по шкале телефона).
 *
 * Кнопка: иконка 12, через 12 — «Меню» Medium 12 белым (подпись не уже 35, как бокс Figma). Зона нажатия шире
 * на 12 в стороны (`-mx-3 px-3`), раскладка от этого не двигается. Вошедшему уже 360 и всем уже 320 — только
 * иконка: подпись остаётся для скринридеров, имя кнопки — «Меню». Есть непрочитанные уведомления — красная
 * точка 6 у иконки и «N новых уведомлений» в имени кнопки.
 *
 * Шторка (Radix Dialog): панель справа, в 12 от краёв экрана (с учётом выреза), ширина 336 (уже 384 — на 48
 * меньше окна: слева видна подложка, по ней можно закрыть), высота по содержимому, длиннее экрана — прокрутка
 * внутри. #181821, скругление 12, поля 12, между группами 12, внутри группы 3. Сверху вниз: вошедший — аватар 36,
 * ник DemiBold 12 и «Ур. N · ID X» Medium 12 белым 50 % (гость — заголовок «Меню» DemiBold 16), справа
 * «Закрыть» 36; выбор игры; разделы сайта; вошедший — уведомления (раскрываются списком), профиль, инвентарь,
 * настройки, админка (гость — лаймовая «Вход»); язык и звук; вошедший — «Выйти».
 *
 * Закрывается по Esc, «Закрыть», тапу по подложке, переходу по любой ссылке, смене пути (выбор игры, «назад»)
 * и когда окно становится шире телефона; тап по тосту шторку не закрывает (тосты при открытой шторке — ниже
 * её строки аккаунта, globals.css). Фокус при открытии — на «Закрыть», внутри шторки по кругу, после
 * закрытия — снова на «Меню». Кнопка «Назад» Android шторку не закрывает (уходит по истории, как раньше).
 */
export function MobileMenu({ me }: { me: MeDto | null }) {
  const t = useTranslations();
  const pathname = usePathname();
  const openLogin = useUi((s) => s.openLogin);
  const [open, setOpen] = useState(false);

  // Смена пути (ссылка, выбор игры, «назад») закрывает шторку — состояние сбрасывается прямо при рендере.
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(false);
  }

  // Окно стало шире телефона (поворот, окно через 768): шторки и её кнопки там нет — закрыть.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(MD_UP);
    const onChange = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [open]);

  // Гостю запрос не уходит (enabled = false); вошедшему — общий кэш с колокольчиком шапки компьютера.
  const list = useNotificationsList(Boolean(me));
  const unread = me ? (list.data?.unread ?? 0) : 0;
  const markAll = useMarkAllRead();
  // Раздел уведомлений раскрывали за это открытие шторки: только тогда сворачивание раздела или закрытие шторки
  // отмечает их прочитанными (раздел свёрнут по умолчанию — иначе «открыл и закрыл меню» молча гасил бы точку).
  const seen = useRef(false);
  useEffect(() => {
    if (open) return;
    if (seen.current && unread > 0) void markAll();
    seen.current = false;
  }, [open, unread, markAll]);
  const toggleNotifications = (expanded: boolean) => {
    if (expanded) {
      seen.current = true;
      return;
    }
    if (seen.current && unread > 0) void markAll();
    seen.current = false;
  };

  // Гость нажал «Вход» в шторке: окно входа — после закрытия шторки, когда фокус уже вернулся на «Меню»
  // (окно входа запомнит его и вернёт туда же).
  const pendingLogin = useRef(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        data-testid="mobile-menu-open"
        className="relative -mx-3 flex h-9 shrink-0 items-center gap-3 px-3 text-[12px] font-medium text-white"
      >
        <MenuIcon size={12} className="shrink-0" />
        {/*
          Ширина подписи не меньше 35 — бокс Figma (34,33 → 35): текст с x 201 на 360 (слева, а не по центру,
          как в кнопке по умолчанию), до «Вход» ровно 18.
        */}
        <span
          className={cn(
            'min-w-[35px] text-left',
            me && 'max-[360px]:sr-only max-[360px]:min-w-0',
            'max-[320px]:sr-only max-[320px]:min-w-0',
          )}
        >
          {t('header.menu')}
        </span>
        {unread > 0 && (
          <>
            <span
              aria-hidden="true"
              className="absolute left-[21px] top-[9px] size-1.5 rounded-full bg-danger ring-2 ring-surface-1"
            />
            <span className="sr-only">{t('mobileMenu.unread', { count: unread })}</span>
          </>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* Подложка без размытия: размытие во весь экран на время выезда тяжело для слабых телефонов. */}
        <Dialog.Overlay className="gr-overlay gr-drawer-overlay fixed inset-0 z-50 bg-black/70 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          // Нажатие на тост (он над подложкой, ниже строки аккаунта) — не «мимо шторки»: закрывается тост, не шторка.
          onPointerDownOutside={(e) => {
            const target = e.detail.originalEvent.target;
            if (target instanceof Element && target.closest('.gr-toast')) e.preventDefault();
          }}
          onCloseAutoFocus={() => {
            if (!pendingLogin.current) return;
            pendingLogin.current = false;
            queueMicrotask(openLogin);
          }}
          className="gr-drawer fixed right-[calc(env(safe-area-inset-right)+12px)] top-[calc(env(safe-area-inset-top)+12px)] z-50 flex max-h-[calc(100dvh-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[min(336px,calc(100vw-48px))] flex-col overflow-hidden rounded-[12px] bg-surface-1 shadow-[0_18px_48px_rgb(0_0_0/0.55)] outline-none md:hidden"
        >
          <MenuPanel
            me={me}
            unread={unread}
            close={() => setOpen(false)}
            login={() => {
              pendingLogin.current = true;
              setOpen(false);
            }}
            onNotifications={toggleNotifications}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Содержимое шторки: монтируется при открытии, поэтому раздел уведомлений каждый раз свёрнут. */
function MenuPanel({
  me,
  unread,
  close,
  login,
  onNotifications,
}: {
  me: MeDto | null;
  unread: number;
  close: () => void;
  login: () => void;
  onNotifications: (expanded: boolean) => void;
}) {
  const t = useTranslations();
  const game = useGameCode();
  const pathname = usePathname();
  const logout = useLogout();
  const profile: Array<{ key: string; href: string; icon: LucideIcon }> = me
    ? [
        { key: 'profile', href: `/${game}/profile`, icon: User },
        { key: 'inventory', href: `/${game}/profile?tab=inventory`, icon: Backpack },
        { key: 'settings', href: `/${game}/profile?tab=settings`, icon: Settings },
        ...(me.role === 'admin' || me.role === 'support'
          ? [{ key: 'admin', href: '/admin', icon: Shield }]
          : []),
      ]
    : [];

  return (
    // Детям shrink-0: при нехватке высоты flex сжимал бы плитки, а не прокручивал колонку.
    <div className="flex flex-col gap-3 overflow-y-auto overscroll-contain p-3 *:shrink-0">
      <div className="flex min-h-9 items-center gap-3">
        {me ? (
          <>
            <Avatar src={me.avatarUrl} name={me.nickname} className="h-9 w-9 text-[12px]" />
            <div className="flex min-w-0 flex-col gap-[6px]">
              <span className="truncate text-[12px] font-semibold">{me.nickname}</span>
              <span className="truncate text-[12px] font-medium text-white/50">
                {t('header.level', { level: me.level })} · ID {me.shortId}
              </span>
            </div>
            <Dialog.Title className="sr-only">{t('header.menu')}</Dialog.Title>
          </>
        ) : (
          <Dialog.Title className="text-[16px] font-semibold">{t('header.menu')}</Dialog.Title>
        )}
        <Dialog.Close
          aria-label={t('mobileMenu.close')}
          className="ml-auto grid size-9 shrink-0 place-items-center rounded-[6px] bg-[#26262f] text-white/60 transition-colors hover:bg-[#3e3e50] hover:text-white focus-visible:bg-[#3e3e50]"
        >
          <X size={12} />
        </Dialog.Close>
      </div>

      <GameTile />

      <nav aria-label={t('mobileMenu.sections')} className="flex flex-col gap-[3px]">
        {MENU_NAV.map((item) => {
          const active = isActive(pathname, game, item.path);
          return (
            <Link
              key={item.key}
              href={`/${game}${item.path}`}
              onClick={close}
              aria-current={active ? 'page' : undefined}
              className={cn(ROW, active ? 'text-white' : ROW_IDLE)}
            >
              <item.icon size={12} className={cn('shrink-0', active && 'text-lime')} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>

      {me ? (
        <>
          <NotificationsSection unread={unread} onToggle={onNotifications} onNavigate={close} />
          <div className="flex flex-col gap-[3px]">
            {profile.map((item) => (
              <Link key={item.key} href={item.href} onClick={close} className={cn(ROW, ROW_IDLE)}>
                <item.icon size={12} className="shrink-0" />
                <span>{t(`header.${item.key}`)}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        // Без data-testid="login-button": в e2e кнопка шапки находится одна (filter({ visible: true })).
        <button
          type="button"
          onClick={login}
          className="flex h-9 w-full items-center justify-center gap-3 rounded-[6px] bg-lime px-3 text-[12px] font-semibold text-accent-ink transition hover:brightness-110"
        >
          <LoginIcon size={12} className="shrink-0" />
          <span>{t('header.login')}</span>
        </button>
      )}

      <div role="group" aria-label={t('mobileMenu.preferences')} className="flex gap-[3px]">
        <LanguageRow />
        <SoundTile />
      </div>

      {me && (
        <button
          type="button"
          onClick={() => {
            close();
            void logout();
          }}
          className={cn(ROW, 'text-danger')}
        >
          <LogOut size={12} className="shrink-0" />
          <span>{t('header.logout')}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Выбор игры: плитка 36 в стиле десктопного выбора (градиент #282F1E → #26262F, лайм), картинка игры 24 со
 * скруглением 6 в 6 от края, название DemiBold 12 капслоком, стрелка 12 (открыто — вверх). Имя кнопки
 * включает видимое название: «Выбрать игру: Standoff 2».
 */
function GameTile() {
  const t = useTranslations('mobileMenu');
  const { current, games, select } = useGameSelect();
  if (!current) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('game', { name: current.name })}
        className="group flex h-9 w-full items-center gap-3 rounded-[6px] bg-[linear-gradient(90deg,#282f1e,#26262f)] pl-[6px] pr-3 text-[12px] font-semibold uppercase text-lime transition-[filter] hover:brightness-125"
      >
        <GameImage game={current} size={24} />
        <span className="min-w-0 flex-1 truncate text-left">{current.name.replace(/-/g, ' ')}</span>
        <ChevronDownIcon
          size={12}
          className="shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </DropdownMenu.Trigger>
      <GameMenuContent compact games={games} current={current.code} onSelect={select} />
    </DropdownMenu.Root>
  );
}

/**
 * Уведомления: строка-раскрывашка (колокольчик 12, «Уведомления», счётчик непрочитанных 18 — красный, «99+»,
 * стрелка 12); раскрытая показывает тот же список, что поповер колокольчика на компьютере.
 */
function NotificationsSection({
  unread,
  onToggle,
  onNavigate,
}: {
  unread: number;
  onToggle: (expanded: boolean) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('notifications');
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-[3px]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onClick={() => {
          onToggle(!expanded);
          setExpanded(!expanded);
        }}
        className={cn(ROW, ROW_IDLE)}
      >
        <Bell size={12} className="shrink-0" />
        <span className="flex-1 text-left">{t('title')}</span>
        {unread > 0 && (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-[6px] text-[12px] font-semibold text-accent-ink">
            <span>{unread > 99 ? '99+' : unread}</span>
          </span>
        )}
        <ChevronDownIcon
          size={12}
          className={cn('shrink-0 transition-transform duration-150', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div id={id}>
          <NotificationsList phone onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

/** Язык: строка с флагом 16,8×12, названием языка и стрелкой; список — меню телефона (MENU_PANEL). */
function LanguageRow() {
  const t = useTranslations();
  const locale = useLocale();
  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];
  const name = (code: string) => t(`topBar.languages.${code}`);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('mobileMenu.language', { name: name(current.code) })}
        className={cn(ROW, ROW_IDLE, 'group min-w-0 flex-1')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.flag} alt="" width={28} height={20} className="h-3 w-[16.8px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{name(current.code)}</span>
        <ChevronDownIcon
          size={12}
          className="shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={MENU_PANEL}
        >
          <DropdownMenu.RadioGroup value={current.code} className="flex flex-col gap-[3px]">
            {LANGUAGES.map((l) => (
              <DropdownMenu.RadioItem key={l.code} value={l.code} className={MENU_ITEM}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.flag}
                  alt=""
                  width={28}
                  height={20}
                  className="h-3 w-[16.8px] shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{name(l.code)}</span>
                <DropdownMenu.ItemIndicator>
                  <Check size={12} className="text-lime" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Звуки сайта: плитка 36×36, иконка 12 белая 30 % (как переключатель в ряду компьютера). Имя постоянное —
 * «Звуки сайта», включены ли они, говорит aria-pressed (имя-действие с ним звучало бы «Выключить звуки, нажата»).
 */
function SoundTile() {
  const t = useTranslations('mobileMenu');
  const { sound, setSound, on } = useSoundPref();
  return (
    <button
      type="button"
      onClick={() => setSound(!sound)}
      aria-pressed={on}
      aria-label={t('sound')}
      className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-[#26262f] text-white/30 transition-colors hover:bg-[#3e3e50] hover:text-white/60 focus-visible:bg-[#3e3e50]"
    >
      {on ? <SoundOnIcon size={12} /> : <SoundOffIcon size={12} />}
    </button>
  );
}
