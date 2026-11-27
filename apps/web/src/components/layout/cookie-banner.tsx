'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useRef, type ReactNode } from 'react';
import { CookieIcon, DeclineIcon, ShieldCheckIcon } from '@/components/icons/design-icons';
import { cn } from '@/lib/cn';
import { MD_UP } from '@/lib/media';
import { usePrefs, usePrefsHydrated, type CookieConsent } from '@/lib/store';

/**
 * Выбор: «Отклонить» (лайм 10% / лайм) — только обязательные cookie (вход, защита, настройки),
 * «Принять все» (лайм / #181821) — ещё и необязательные (аналитика). Подписи — ru.json → cookies.
 */
const CHOICES = [
  {
    consent: 'necessary',
    label: 'decline',
    Icon: DeclineIcon,
    tone: 'bg-lime/10 text-lime hover:bg-lime/15',
  },
  {
    consent: 'all',
    label: 'accept',
    Icon: ShieldCheckIcon,
    tone: 'bg-lime text-[#181821] hover:brightness-110',
  },
] as const satisfies readonly {
  consent: CookieConsent;
  label: string;
  Icon: typeof DeclineIcon;
  tone: string;
}[];

/**
 * Кнопка на телефоне (макет 42.png): высота 36, скругление 6, иконка 12, между иконкой и подписью 12, поля 12
 * и 16 справа, DemiBold 12. Подпись — в span: обрезка по прописным (text-box) действует на элемент, а не на
 * голый текст во flex, — так подпись по центру кнопки, как в макете и у «Входа» в шапке телефона. Ряд не
 * помещается (окно уже ~303) — кнопки встают в столбик на всю ширину плашки, содержимое ровно по центру: поля
 * по 12, а последние 4 справа — пустой ::after не уже 4; лишнее место ::before и ::after делят поровну (в ряду
 * его нет — ::before 0, ::after 4, справа 16). Зазор 12 — полем подписи: gap встал бы и у псевдоэлементов.
 */
const PHONE_BUTTON =
  'flex h-9 grow items-center whitespace-nowrap rounded-[6px] px-3 text-[12px] font-semibold transition before:grow after:min-w-1 after:grow';

/** Кнопка от 768 (макет): скругление 12, DemiBold 24, иконка 24, между иконкой и текстом 24, поля 24 и 36 справа. */
const BUTTON =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-[12px] py-6 pl-6 pr-9 text-[24px] font-semibold transition';

/**
 * Уведомление о cookie; выбор хранится в настройках (cookieConsent). Ширину плашки задаёт ряд кнопок, текст
 * переносится по ней.
 * Телефон (< 768, макет 42.png, на 360 — ≈278×160): плашка внизу по центру над нижним меню (низ — в 12 над ним),
 * #181821, скругление 18, поля 12; иконка 16 + 12 + заголовок DemiBold 16; через 12 — текст Medium 12
 * (межстрочный 100%, как везде), через 16 — кнопки, между ними 12. Плашка не шире окна без полей 12.
 * От 768 (макет): плашка в правом нижнем углу в 24px от краёв, скругление 36, поля 24; иконка 36 + 24 +
 * заголовок DemiBold 36; через 24 — текст Medium 24, через 36 — кнопки, между ними 24.
 */
export function CookieBanner() {
  const t = useTranslations('cookies');
  const hydrated = usePrefsHydrated();
  const consent = usePrefs((s) => s.cookieConsent);
  const setConsent = usePrefs((s) => s.setCookieConsent);
  /** Откуда фокус пришёл в плашку — туда он вернётся после выбора с клавиатуры. */
  const cameFrom = useRef<HTMLElement | null>(null);
  /**
   * Пока плашка видна на телефоне, её высота — в --cookie-h на <html>: по ней прокрутка к фокусу, низ подвала и
   * панель «Продать выбранные» уходят выше плашки (globals.css → --cookie-space). Плашка скрылась (выбор
   * сделан) или размонтирована — переменной нет, всё как без плашки. От 768 переменная не нужна и не пишется:
   * запись в стиль <html> перерисовывает страницу (на 768 от неё менялось сглаживание угла картинки игры).
   */
  const trackHeight = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const wide = window.matchMedia(MD_UP);
    const update = () => {
      if (wide.matches) root.style.removeProperty('--cookie-h');
      else root.style.setProperty('--cookie-h', `${el.getBoundingClientRect().height}px`);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    wide.addEventListener('change', update);
    return () => {
      ro.disconnect();
      wide.removeEventListener('change', update);
      root.style.removeProperty('--cookie-h');
    };
  }, []);
  if (!hydrated || consent) return null;

  /**
   * С клавиатуры (Enter / Space — щелчок с detail 0) нажатая кнопка исчезает вместе с плашкой, и фокус ушёл бы
   * на body: возвращаем его туда, откуда он пришёл в плашку, если тот элемент ещё на странице. Касание и мышь —
   * как раньше: иначе на телефоне у поля, где был фокус, снова всплывала бы клавиатура.
   */
  const choose = (value: CookieConsent, byKeyboard: boolean) => {
    const back = cameFrom.current;
    if (byKeyboard && back?.isConnected) back.focus();
    setConsent(value);
  };

  return (
    <div
      ref={trackHeight}
      role="region"
      aria-labelledby="cookie-banner-title"
      data-testid="cookie-banner"
      // Фокус вошёл в плашку — запоминаем, откуда; ушёл к другому элементу — забываем. Переходы «ниоткуда»
      // (окно браузера потеряло и вернуло фокус) запомненное не трогают.
      onFocus={(e) => {
        const from = e.relatedTarget;
        if (from instanceof HTMLElement && !e.currentTarget.contains(from)) cameFrom.current = from;
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) cameFrom.current = null;
      }}
      // Телефон: inset-x-3 + mx-auto + w-fit — по центру и по ширине содержимого, но не шире окна без полей 12.
      className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] z-40 mx-auto flex w-fit md:bottom-6 md:left-auto md:right-6 md:mx-0 md:w-auto"
    >
      {/* Плашка — flex-элемент обёртки, а не строчный блок: иначе обрезка текста по базовой линии
          (text-box) срезала бы высоту обёртки и низ плашки уходил за экран. Тень отделяет плашку от
          карточек того же цвета под ней; на телефоне она вдвое меньше, как и остальные размеры. */}
      <div className="flex flex-col rounded-[18px] bg-surface-1 p-3 shadow-[0_9px_24px_rgb(0_0_0/0.55)] md:rounded-[36px] md:p-6 md:shadow-[0_18px_48px_rgb(0_0_0/0.55)]">
        <div className="flex items-center gap-3 md:gap-6">
          <CookieIcon size={16} className="shrink-0 text-white md:size-9" />
          {/* На телефоне заголовок переносится (окно уже ~260), а не вылезает за плашку. */}
          <h2
            id="cookie-banner-title"
            className="text-[16px] font-semibold md:whitespace-nowrap md:text-[36px]"
          >
            {t('title')}
          </h2>
        </div>
        {/* w-0 min-w-full: текст не расширяет плашку, а переносится по ширине ряда кнопок. Контур фокуса ссылки
            на телефоне — вплотную к прописным (outline-offset 0): между строками 12 всего 3,6 от базовой линии до
            прописных следующей, и общий контур (2 + 2) лёг бы на низ букв строки над ссылкой. */}
        <p className="mt-3 w-0 min-w-full text-[12px] font-medium text-white md:mt-6 md:text-[24px]">
          {t.rich('text', {
            link: (chunks: ReactNode) => (
              <Link
                href="/legal/cookies"
                className="text-lime underline decoration-1 underline-offset-[2.5px] hover:brightness-110 max-md:focus-visible:outline-offset-0 md:underline-offset-[5px]"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        {/* Ряд кнопок — свой на телефоне и от 768: на телефоне подпись в span (см. PHONE_BUTTON), от 768
            разметка прежняя — голый текст, и десктоп не меняется ни на пиксель. Скрытый ряд — display: none:
            его нет ни в порядке фокуса, ни у читалок. */}
        <div className="mt-4 flex flex-wrap gap-3 md:hidden">
          {CHOICES.map(({ consent: value, label, Icon, tone }) => (
            <button
              key={value}
              type="button"
              onClick={(e) => choose(value, e.detail === 0)}
              className={cn(PHONE_BUTTON, tone)}
            >
              <Icon size={12} className="shrink-0" />
              <span className="ml-3">{t(label)}</span>
            </button>
          ))}
        </div>
        <div className="mt-9 flex gap-6 max-md:hidden">
          {CHOICES.map(({ consent: value, label, Icon, tone }) => (
            <button
              key={value}
              type="button"
              onClick={(e) => choose(value, e.detail === 0)}
              className={cn(BUTTON, tone)}
            >
              <Icon />
              {t(label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
