'use client';

import { WS_EVENTS, WS_ROOMS, formatGems, type FeedDropDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useGameCode } from '@/lib/game';
import { fullCards, trackStep, visibleCards } from '@/lib/live-feed';
import { prefersReducedMotion } from '@/lib/motion';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { OnlineFrame } from './online';

/** Сколько дропов держим: автопрокрутка повторяет их по кругу (сервер хранит последние 60). */
const MAX = 60;
/** Пауза между «новыми» дропами автопрокрутки, мс (случайно в этих пределах — живее). */
const AUTO_MIN_MS = 400;
const AUTO_MAX_MS = 800;
/** Сдвиг короче самой короткой паузы — успевает закончиться до следующего. */
const SLIDE = 'transform 350ms cubic-bezier(0.22, 0.8, 0.25, 1)';

/** Карточки дорожки (ссылки) — для шага ленты из разметки. */
const cardsOf = (track: HTMLElement | null) =>
  track?.children as HTMLCollectionOf<HTMLElement> | undefined;

interface FeedItem {
  /** Уникален для каждого показа: повтор дропа автопрокруткой получает новый ключ. */
  key: string;
  drop: FeedDropDto;
}

/**
 * Карточка дропа 240×150 (макет): картинка скина 200×100, под ней через 12 — название
 * (Medium 18, 14 от нижнего края), внизу по центру полоса редкости 140×2.
 * Свечение — два размытых эллипса цвета редкости: 192×138 (blur 100 в Figma → 50px в CSS)
 * и 240×88, уходящий на 44 ниже карточки (blur 60 → 30px).
 * Телефон (< 768, макет 36.png, Figma 37/38.png): 90×60, скругление 6; рамка скина 80×40 в 6 от верха,
 * картинка — во внутреннем поле 60×40; название Medium 8 в 6 от низа; полоса 60×1; свечения и мазок
 * drop-styled-bg — в globals.css.
 * При наведении вместо скина — кейс, из которого он выпал, и ник игрока (на устройствах без наведения
 * картинка кейса не грузится). Фокус с клавиатуры — рамка внутри карточки: снаружи её срезало бы окно ленты.
 * tabIndex −1 — карточка не остановка Tab (за краем окна ленты, см. LiveFeed); читалкам она доступна.
 */
function DropCard({ drop, tabIndex }: { drop: FeedDropDto; tabIndex?: number }) {
  const t = useTranslations('topBar');
  const hoverImage = drop.caseImage;
  // Приз груза разыгран, а не выпал: «Выигран в «…»» (caseName — название груза, caseImage — его миниатюра).
  const hoverTitle = drop.caseName
    ? t(drop.source === 'cargo' ? 'dropFromCargo' : 'dropFrom', { name: drop.caseName })
    : t(`sources.${drop.source}`);
  return (
    <Link
      href={`/${drop.game}/u/${drop.user.shortId}`}
      tabIndex={tabIndex}
      className="drop-card group relative h-[60px] w-[90px] shrink-0 overflow-hidden rounded-[6px] bg-surface-1 focus-visible:outline-offset-[-2px] md:h-[150px] md:w-[240px] md:rounded-[12px]"
      style={{ '--rc': drop.item.rarityColor } as CSSProperties}
      title={`${drop.user.nickname} · ${drop.item.skinName} · ${formatGems(drop.item.price)}${hoverTitle ? ` · ${hoverTitle}` : ''}`}
    >
      <span className="drop-card__glow-a" aria-hidden="true" />
      <span className="drop-card__glow-b" aria-hidden="true" />
      <span className="drop-card__brush" aria-hidden="true" />
      {/* рамка скина: телефон — 80×40 в 6 от верха, картинка во внутреннем поле 60×40 (по 10 с боков) */}
      <span className="absolute left-[5px] top-[6px] h-[40px] w-[80px] px-[10px] md:left-5 md:top-[11.4px] md:h-[100px] md:w-[200px] md:px-0">
        {drop.item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drop.item.imageUrl}
            alt=""
            className={cn(
              'h-full w-full object-contain transition-opacity duration-200',
              // без наведения (телефон) картинки кейса нет — скин остаётся и при фокусе
              hoverImage &&
                'group-hover:opacity-0 [@media(hover:hover)]:group-focus-visible:opacity-0',
            )}
            loading="lazy"
            draggable={false}
          />
        )}
        {hoverImage && (
          // на устройствах без наведения не показывается и не грузится (loading lazy + display none)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hoverImage}
            alt=""
            className="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:hidden"
            loading="lazy"
            draggable={false}
          />
        )}
      </span>
      <span className="absolute inset-x-[6px] bottom-[6px] text-center text-[8px] font-medium md:inset-x-4 md:bottom-[14px] md:text-[18px]">
        <span className="block truncate group-hover:hidden group-focus-visible:hidden">
          {drop.item.skinName}
        </span>
        <span className="hidden truncate group-hover:block group-focus-visible:block">
          {drop.user.nickname}
        </span>
      </span>
      <span
        className="absolute bottom-0 left-1/2 h-px w-[60px] -translate-x-1/2 rounded-[1px] md:h-[2px] md:w-[140px] md:rounded-[2px]"
        style={{ background: drop.item.rarityColor }}
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Лента последних дропов игры (REST + новые по WebSocket). Уходит до правого края экрана;
 * справа — затемнение 165×150 (#121117 0% → 100%) и плашка онлайна в 48px от края.
 * Телефон (< 768, макет 36.png): слева плитка онлайна 58×60, через 3 — окно ленты до края экрана,
 * карточки 90×60 через 3, затемнение — последние 101 px экрана.
 *
 * Пока ответа ленты нет — пустое окно цвета карточек (без текста: он мелькал бы при каждой загрузке);
 * «Здесь появятся дропы…» — только если дропов нет.
 *
 * Автопрокрутка: каждые 0,4–0,8 с лента сдвигается на карточку вправо, слева въезжает следующий
 * дроп — настоящий новый, если пришёл, иначе самый старый из списка (он как раз ушёл за правый
 * край). Шаг — из разметки (карточка + зазор). Стоит, пока курсор или фокус в ленте, лента вне
 * экрана, вкладка скрыта или в системе включено «уменьшить движение». Окно ленты скруглено на 12
 * (телефон — 6) — обрезанные карточки тоже.
 *
 * Клавиатура: остановки Tab — только карточки целиком в окне (на 360 — три). Фокус на карточке за краем
 * прокручивал бы окно (overflow: hidden), а на телефоне до «Меню» шапки было бы 60 с лишним нажатий;
 * читалкам доступны все карточки. Фокус ушёл из ленты — окно снова в начале (его могли прокрутить к карточке
 * за краем читалка или скрипт), иначе карточки так и стояли бы сдвинутыми.
 */
export function LiveFeed() {
  const t = useTranslations('feed');
  const game = useGameCode();
  const promo = useConfig().promoStrip;
  // null — ответа ленты ещё нет
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstKey = useRef<string | null>(null);
  const seq = useRef(0);
  const paused = useRef(false);
  const inView = useRef(true);
  // Сколько первых карточек — остановки Tab (целиком в окне); до замера — все.
  const [tabStops, setTabStops] = useState(Number.POSITIVE_INFINITY);
  const hasCards = Boolean(items?.length);

  useEffect(() => {
    let alive = true;
    firstKey.current = null;
    api
      .get<FeedDropDto[]>(`/games/${game}/feed`)
      .then((d) => {
        if (alive) setItems(d.slice(0, MAX).map((drop) => ({ key: drop.id, drop })));
      })
      // ленту не получили — пустое состояние (новые дропы всё равно придут по сокету)
      .catch(() => {
        if (alive) setItems((prev) => prev ?? []);
      });
    return () => {
      alive = false;
    };
  }, [game]);

  useRoom(WS_ROOMS.feed(game));
  useSocketEvent<FeedDropDto>(WS_EVENTS.feedDrop, (d) => {
    if (d.game !== game) return;
    setItems((prev) =>
      [{ key: d.id, drop: d }, ...(prev ?? []).filter((x) => x.drop.id !== d.id)].slice(0, MAX),
    );
  });

  // Новые карточки слева: лента мгновенно отъезжает на их ширину назад и плавно возвращается —
  // все карточки съезжают вправо, новая въезжает из-за левого края.
  useLayoutEffect(() => {
    const prev = firstKey.current;
    firstKey.current = items?.[0]?.key ?? null;
    const track = trackRef.current;
    if (!items || !prev || !track || items[0]?.key === prev) return;
    const added = items.findIndex((it) => it.key === prev);
    if (added <= 0 || prefersReducedMotion()) return;
    const step = trackStep(cardsOf(track));
    if (!step) return;
    track.style.transition = 'none';
    track.style.transform = `translateX(${-added * step}px)`;
    void track.offsetWidth;
    track.style.transition = SLIDE;
    track.style.transform = 'translateX(0)';
  }, [items]);

  // Остановки Tab: пересчёт при смене ширины окна ленты (размеры карточек меняются вместе с ней — от 768).
  // Зазор дорожки — из стиля: если лента была пуста и дропы пришли по сокету, считаем по одной карточке, а при
  // следующих пересчёта нет — без зазора шаг вышел бы короче и осталась бы лишняя остановка у края окна.
  useEffect(() => {
    const win = windowRef.current;
    if (!hasCards || !win) return;
    const update = () => {
      const track = trackRef.current;
      const gap = track ? parseFloat(getComputedStyle(track).columnGap) || 0 : 0;
      setTabStops(fullCards(win.clientWidth, cardsOf(track), gap));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(win);
    return () => ro.disconnect();
  }, [hasCards]);

  // Пока лента вне экрана — не крутим.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      inView.current = Boolean(e?.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Автопрокрутка «чтобы была активность»: повторяем самый старый дроп слева.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(tick, AUTO_MIN_MS + Math.random() * (AUTO_MAX_MS - AUTO_MIN_MS));
    };
    const tick = () => {
      // ширина окна ленты, а не секции: на телефоне в секции ещё плитка онлайна
      const width = windowRef.current?.clientWidth ?? 0;
      if (!document.hidden && inView.current && !paused.current && width > 0) {
        // Повторять можно, только если хвост ленты уже за правым краем — иначе карточка
        // исчезла бы справа у всех на виду.
        const visible = visibleCards(width, trackStep(cardsOf(trackRef.current)));
        setItems((prev) => {
          const last = prev && prev[prev.length - 1];
          if (!prev || !last || prev.length <= visible) return prev;
          seq.current += 1;
          return [{ key: `${last.drop.id}:${seq.current}`, drop: last.drop }, ...prev.slice(0, -1)];
        });
      }
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const pause = () => {
    paused.current = true;
  };
  const resume = () => {
    paused.current = false;
  };
  // Фокус перешёл на другую карточку — ничего; ушёл из ленты — окно в начало и автопрокрутка дальше.
  const leave = (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (windowRef.current) windowRef.current.scrollLeft = 0;
    resume();
  };

  return (
    // flex и зазор — только на телефоне (max-md:): от 768 секция и окно те же, что были
    <section
      ref={sectionRef}
      className="relative h-[60px] min-w-0 flex-1 max-md:flex max-md:gap-[3px] md:h-[150px]"
      aria-label={t('title')}
      aria-busy={items === null || undefined}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={leave}
    >
      <div
        ref={windowRef}
        className="h-full overflow-hidden rounded-[6px] max-md:min-w-0 max-md:flex-1 md:rounded-[12px]"
      >
        {items === null ? (
          <div className="h-full w-full rounded-[6px] bg-surface-1 md:rounded-[12px]" />
        ) : items.length === 0 ? (
          <div className="flex h-full w-full items-center rounded-[6px] bg-surface-1 px-3 text-[12px] font-medium text-white/40 md:rounded-[12px] md:px-6 md:text-[18px]">
            {t('empty')}
          </div>
        ) : (
          <div ref={trackRef} className="flex h-full gap-[3px] will-change-transform md:gap-[6px]">
            {items.map((it, i) => (
              <DropCard key={it.key} drop={it.drop} tabIndex={i < tabStops ? undefined : -1} />
            ))}
          </div>
        )}
      </div>
      {/* затемнение справа: телефон — последние 101 px экрана, от 768 — 165; на телефоне без карточек не нужно */}
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-[101px] bg-[linear-gradient(90deg,rgb(18_17_23/0),#121117)] md:w-[165px]',
          !items?.length && 'max-md:hidden',
        )}
        aria-hidden="true"
      />
      {/*
       * Телефон — плитка слева от окна (order-first: в DOM на том же месте, что от 768), без промо-полосы
       * её левый верхний угол — внешний угол верхнего блока (18). От 768 — поверх ленты у правого края.
       */}
      <OnlineFrame
        className={cn(
          'order-first md:absolute md:right-12 md:top-1/2 md:order-none md:-translate-y-1/2',
          !promo && 'max-md:rounded-tl-[18px]',
        )}
      />
    </section>
  );
}
