'use client';

import { WS_EVENTS, WS_ROOMS, formatGems, type FeedDropDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { prefersReducedMotion } from '@/lib/motion';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { OnlineFrame } from './online';

const MAX = 24;
/** Шаг ленты: карточка 240 + промежуток 6. */
const STEP = 246;
/** Пауза между «новыми» дропами автопрокрутки, мс (случайно в этих пределах — живее). */
const AUTO_MIN_MS = 2000;
const AUTO_MAX_MS = 4000;
const SLIDE = 'transform 700ms cubic-bezier(0.22, 0.8, 0.25, 1)';

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
 * При наведении вместо скина — кейс, из которого он выпал, и ник игрока.
 */
function DropCard({ drop }: { drop: FeedDropDto }) {
  const t = useTranslations('topBar');
  const hoverImage = drop.caseImage;
  const hoverTitle = drop.caseName
    ? t('dropFrom', { name: drop.caseName })
    : t(`sources.${drop.source}`);
  return (
    <Link
      href={`/${drop.game}/u/${drop.user.shortId}`}
      className="drop-card group relative h-[150px] w-[240px] shrink-0 overflow-hidden rounded-[12px] bg-surface-1"
      style={{ '--rc': drop.item.rarityColor } as CSSProperties}
      title={`${drop.user.nickname} · ${drop.item.skinName} · ${formatGems(drop.item.price)}${hoverTitle ? ` · ${hoverTitle}` : ''}`}
    >
      <span className="drop-card__glow-a" aria-hidden="true" />
      <span className="drop-card__glow-b" aria-hidden="true" />
      <span className="drop-card__brush" aria-hidden="true" />
      <span className="absolute left-5 top-[11.4px] h-[100px] w-[200px]">
        {drop.item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drop.item.imageUrl}
            alt=""
            className={cn(
              'h-full w-full object-contain transition-opacity duration-200',
              hoverImage && 'group-hover:opacity-0 group-focus-visible:opacity-0',
            )}
            loading="lazy"
            draggable={false}
          />
        )}
        {hoverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hoverImage}
            alt=""
            className="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            loading="lazy"
            draggable={false}
          />
        )}
      </span>
      <span className="absolute inset-x-4 bottom-[14px] text-center text-[18px] font-medium">
        <span className="block truncate group-hover:hidden group-focus-visible:hidden">
          {drop.item.skinName}
        </span>
        <span className="hidden truncate group-hover:block group-focus-visible:block">
          {drop.user.nickname}
        </span>
      </span>
      <span
        className="absolute bottom-0 left-1/2 h-[2px] w-[140px] -translate-x-1/2 rounded-[2px]"
        style={{ background: drop.item.rarityColor }}
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Лента последних дропов игры (REST + новые по WebSocket). Уходит до правого края экрана;
 * справа — затемнение 165×150 (#121117 0% → 100%) и плашка онлайна в 48px от края.
 *
 * Автопрокрутка: каждые 2–4 с лента сдвигается на карточку вправо, слева въезжает следующий
 * дроп — настоящий новый, если пришёл, иначе самый старый из списка (он как раз ушёл за правый
 * край). Стоит, пока курсор или фокус в ленте, лента вне экрана, вкладка скрыта или в системе
 * включено «уменьшить движение». Окно ленты скруглено на 12 — обрезанные карточки тоже.
 */
export function LiveFeed() {
  const t = useTranslations('feed');
  const game = useGameCode();
  const [items, setItems] = useState<FeedItem[]>([]);
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstKey = useRef<string | null>(null);
  const seq = useRef(0);
  const paused = useRef(false);
  const inView = useRef(true);

  useEffect(() => {
    let alive = true;
    firstKey.current = null;
    api
      .get<FeedDropDto[]>(`/games/${game}/feed`)
      .then((d) => {
        if (alive) setItems(d.slice(0, MAX).map((drop) => ({ key: drop.id, drop })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game]);

  useRoom(WS_ROOMS.feed(game));
  useSocketEvent<FeedDropDto>(WS_EVENTS.feedDrop, (d) => {
    if (d.game !== game) return;
    setItems((prev) =>
      [{ key: d.id, drop: d }, ...prev.filter((x) => x.drop.id !== d.id)].slice(0, MAX),
    );
  });

  // Новые карточки слева: лента мгновенно отъезжает на их ширину назад и плавно возвращается —
  // все карточки съезжают вправо, новая въезжает из-за левого края.
  useLayoutEffect(() => {
    const prev = firstKey.current;
    firstKey.current = items[0]?.key ?? null;
    const track = trackRef.current;
    if (!prev || !track || items[0]?.key === prev) return;
    const added = items.findIndex((it) => it.key === prev);
    if (added <= 0 || prefersReducedMotion()) return;
    track.style.transition = 'none';
    track.style.transform = `translateX(${-added * STEP}px)`;
    void track.offsetWidth;
    track.style.transition = SLIDE;
    track.style.transform = 'translateX(0)';
  }, [items]);

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
      const width = sectionRef.current?.clientWidth ?? 0;
      if (!document.hidden && inView.current && !paused.current && width > 0) {
        // Повторять можно, только если хвост ленты уже за правым краем — иначе карточка
        // исчезла бы справа у всех на виду.
        const visible = Math.ceil(width / STEP) + 1;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (!last || prev.length <= visible) return prev;
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

  return (
    <section
      ref={sectionRef}
      className="relative h-[150px] min-w-0 flex-1"
      aria-label={t('title')}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <div className="h-full overflow-hidden rounded-[12px]">
        {items.length === 0 ? (
          <div className="flex h-full w-full items-center rounded-[12px] bg-surface-1 px-6 text-[18px] font-medium text-white/40">
            {t('empty')}
          </div>
        ) : (
          <div ref={trackRef} className="flex h-full gap-[6px] will-change-transform">
            {items.map((it) => (
              <DropCard key={it.key} drop={it.drop} />
            ))}
          </div>
        )}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[165px] bg-[linear-gradient(90deg,rgb(18_17_23/0),#121117)] md:block"
        aria-hidden="true"
      />
      <OnlineFrame className="absolute right-12 top-1/2 hidden -translate-y-1/2 md:flex" />
    </section>
  );
}
