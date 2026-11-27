'use client';

import {
  WS_EVENTS,
  WS_ROOMS,
  formatGems,
  type CaseDetailDto,
  type CaseOpenResultDto,
  type CaseSupplyPayload,
  type ItemDto,
  type SellResultDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FastIcon, GiftIcon, OpenIcon } from '@/components/icons/design-icons';
import { ItemTile } from '@/components/items/item-tile';
import { SkinCard } from '@/components/items/skin-card';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { GemAmount } from '@/components/ui/gem';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import type { CaseNeighbours } from '@/lib/case-page';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { PHONE_MEDIA, useMediaQuery } from '@/lib/media';
import { prefersReducedMotion } from '@/lib/motion';
import { usePrefToggles } from '@/lib/prefs';
import { useInvalidateWallet } from '@/lib/queries';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { sound } from '@/lib/sound';
import { usePrefs, usePrefsHydrated, useUi } from '@/lib/store';
import { CaseStageIdle } from './case-stage';
import { CaseRoulette, CaseStrip } from './roulette';

function tierOf(price: number, casePrice: number): number {
  const base = Math.max(casePrice, 1);
  if (price >= base * 5) return 3;
  if (price >= base * 2) return 2;
  if (price >= base) return 1;
  return 0;
}

/** Сцена: покой (кейс, копии, соседи) → прокрутка → окно результата → снова покой. */
type Phase = 'idle' | 'spinning' | 'result';

/**
 * Где крутится лента: band — рулетка на месте кейса (планшет и десктоп), strip — дроплента под кнопкой
 * открытия (телефон, < 768; кейс остаётся на месте). Решается в момент открытия по ширине окна; окно перешло
 * через 768 посреди прокрутки (поворот телефона) — прокрутка доводится сразу в месте новой раскладки.
 */
type SpinPlace = 'band' | 'strip';

/**
 * Состояние кнопки открытия: ready — #B7FF00 (хватает баланса, гость — откроется вход),
 * insufficient — #FF2529 (не хватает — откроется пополнение), blocked — #26262F (кейс недоступен),
 * loading — пока неизвестно, вошёл ли пользователь и что ему доступно: приглушена, как во время
 * прокрутки, чтобы не обещать «готово» тому, кому потом окажется красной или серой.
 */
type OpenState = 'ready' | 'insufficient' | 'blocked' | 'loading';

/**
 * Страница кейса (макет «сцена»): название, полоса 286 с кейсом / копиями / рулеткой, под ней
 * кнопки количества, открытия (под ней — строка ошибки или пояснения) и «Быстро»; на телефоне
 * (макет 39.png) — полоса 120 с кейсом, ряд кнопок 36 и ниже дроплента, которая и крутится. Сервер
 * решает выигрыш; рулетка и дроплента только показывают его.
 */
export function CaseOpener({
  game,
  initial,
  neighbours,
}: {
  game: string;
  initial: CaseDetailDto;
  neighbours: CaseNeighbours | null;
}) {
  const t = useTranslations();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);
  const prefsHydrated = usePrefsHydrated();
  const fast = usePrefs((s) => s.fast);
  const { setFast } = usePrefToggles();
  const infoId = useId();
  /** Кнопка открытия: на неё возвращается фокус после окна результата. */
  const openRef = useRef<HTMLButtonElement>(null);

  const detail = useQuery({
    queryKey: ['case', game, initial.slug, me.data?.id ?? 'guest'],
    queryFn: () => api.get<CaseDetailDto>(`/games/${game}/cases/${initial.slug}`),
    // Гостю сразу показываем данные страницы, но они из кэша страницы (до 15 с и дольше, пока
    // она пересобирается) — при открытии перечитываем: тираж мог закончиться.
    initialData: me.data ? undefined : initial,
    initialDataUpdatedAt: 0,
    enabled: !me.isLoading,
  });
  const c = detail.data ?? initial;
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CaseOpenResultDto | null>(null);
  const [spinId, setSpinId] = useState(0);
  const [sold, setSold] = useState<Set<string>>(new Set());
  const [spinPlace, setSpinPlace] = useState<SpinPlace>('band');
  /** Раскладка телефона (< 768) сейчас; на сервере и при гидратации — нет (окно итога в это время закрыто). */
  const phone = useMediaQuery(PHONE_MEDIA);
  /** Прокрутка доводится без анимации, как в быстром режиме: окно перешло через 768 посреди прокрутки. */
  const [settleNow, setSettleNow] = useState(false);
  /** Выигрыши последней прокрутки на телефоне: дроплента держит их под меткой до нового открытия или смены количества. */
  const [stripWinners, setStripWinners] = useState<ItemDto[] | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  /** Остановившиеся дорожки текущей прокрутки (Set — повторный вызов в StrictMode не считается). */
  const finished = useRef<Set<number>>(new Set());
  const resultRef = useRef<CaseOpenResultDto | null>(null);

  /** Остаток тиража — в данных кейса (у гостя и у вошедшего): из сокета и из ответа на открытие. */
  const setSupply = useCallback(
    (used: number, total: number) =>
      qc.setQueriesData<CaseDetailDto>({ queryKey: ['case', game, initial.slug] }, (d) =>
        d ? { ...d, supplyUsed: used, supplyTotal: total } : d,
      ),
    [qc, game, initial.slug],
  );
  useRoom(c.supplyTotal !== null ? WS_ROOMS.case(c.id) : null);
  useSocketEvent<CaseSupplyPayload>(WS_EVENTS.caseSupply, (p) => {
    if (p.caseId === c.id) setSupply(p.supplyUsed, p.supplyTotal);
  });
  const supply = c.supplyTotal !== null ? { used: c.supplyUsed, total: c.supplyTotal } : null;
  const soldOut = supply !== null && supply.used >= supply.total;

  const casePrice = c.price;
  const onLaneDone = useCallback(
    (lane: number) => {
      const res = resultRef.current;
      if (!res || finished.current.has(lane)) return;
      finished.current.add(lane);
      if (finished.current.size < res.results.length) return;
      const best = Math.max(...res.results.map((r) => tierOf(r.item.price, casePrice)));
      sound.win(best);
      setPhase('result');
    },
    [casePrice],
  );

  const a = c.availability;
  // Тираж закончился (в том числе по сокету, пока страница открыта) — недоступен всем.
  const reason = soldOut ? 'SOLD_OUT' : a.reason;
  const free = c.kind === 'free';
  const signedIn = Boolean(me.data);
  const spinning = phase === 'spinning';
  // Вошёл, но доступность для него ещё не пришла (на руках гостевая) — ждём, а не пугаем «недоступен».
  // Не пришла совсем (ошибка запроса) — не ждём и не запрещаем: при открытии всё равно решит сервер.
  const loading = me.isLoading || (signedIn && a.reason === 'LOGIN' && !detail.isError);
  // Закончившийся тираж и снятый с витрины кейс недоступны и гостю; остальное решает сервер для вошедшего.
  const blocked = signedIn
    ? !loading && (soldOut || (!a.canOpen && a.reason !== 'LOGIN'))
    : reason === 'SOLD_OUT' || reason === 'UNAVAILABLE';
  const openCount = free ? 1 : count;
  const total = c.price * openCount;
  const insufficient = Boolean(me.data && !loading && !blocked && !free && me.data.balance < total);
  const openState: OpenState = loading
    ? 'loading'
    : blocked
      ? 'blocked'
      : insufficient
        ? 'insufficient'
        : 'ready';
  // Нажать нельзя, но кнопка остаётся в фокусе (aria-disabled, а не disabled): иначе на время
  // прокрутки фокус падает на <body>, и с клавиатуры не вернуться к кнопке.
  const openInactive = openState === 'loading' || openState === 'blocked' || spinning || busy;

  const open = async (useBonus = false) => {
    if (!me.data) return openLogin();
    if (!useBonus && insufficient) return openDeposit();
    if (busy || spinning || loading) return;
    setBusy(true);
    try {
      const res = await api.post<CaseOpenResultDto>(
        `/games/${game}/cases/${c.slug}/open`,
        useBonus ? { count: 1, useBonus: true } : { count: openCount },
        { idempotencyKey: newIdempotencyKey() },
      );
      if (useBonus) setCount(1);
      void qc.invalidateQueries({ queryKey: ['entitlements'] });
      const place: SpinPlace =
        typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MEDIA).matches
          ? 'strip'
          : 'band';
      finished.current = new Set();
      resultRef.current = res;
      setSold(new Set());
      setResult(res);
      setSettleNow(false);
      setSpinPlace(place);
      setStripWinners(place === 'strip' ? res.results.map((r) => r.item) : null);
      setSpinId((x) => x + 1);
      setPhase('spinning');
      if (!fast) sound.open();
      if (res.supplyUsed !== null && res.supplyTotal !== null)
        setSupply(res.supplyUsed, res.supplyTotal);
      invalidate();
      void qc.invalidateQueries({ queryKey: ['case', game, c.slug] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        toast.error(t('case.notEnough'));
        openDeposit();
      } else toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Новое количество: дроплента возвращается к витрине (лент — по количеству). Повторное нажатие на уже
   * выбранное ничего не сбрасывает — выигрыш остаётся под меткой.
   */
  const chooseCount = (n: number) => {
    if (n === count) return;
    setCount(n);
    setStripWinners(null);
  };

  // Прокрутка на телефоне: ленты (при x5 — 378 в высоту) должны быть на экране целиком — докручиваем,
  // если нужно (scroll-padding-bottom у html учитывает нижнее меню).
  useEffect(() => {
    if (phase !== 'spinning' || spinPlace !== 'strip') return;
    stripRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [phase, spinPlace, spinId]);

  // Окно перешло через 768 посреди прокрутки (поворот телефона): лента прежнего места скрыта (дроплента от 768)
  // или посчитана по чужой геометрии (рулетка сцены в полосе 120 телефона). Прокрутка доводится сразу, как в
  // быстром режиме, лентой новой раскладки: выигрыш встаёт под метку, открывается окно итога. Скрытая дроплента
  // (ландшафт) доезжает сама и остаётся на выигрыше.
  useEffect(() => {
    const res = resultRef.current;
    if (phase !== 'spinning' || !res) return;
    const place: SpinPlace = phone ? 'strip' : 'band';
    if (place === spinPlace) return;
    setSettleNow(true);
    setSpinPlace(place);
    if (place === 'strip') setStripWinners(res.results.map((r) => r.item));
  }, [phone, phase, spinPlace]);

  /** Окно результата закрыто — сцена возвращается в покой (дроплента остаётся на выигрыше). */
  const closeResult = () => {
    setPhase('idle');
    setResult(null);
    resultRef.current = null;
  };

  const sell = async (userItemIds: string[]) => {
    try {
      const res = await api.post<SellResultDto>(
        `/games/${game}/inventory/sell`,
        { userItemIds },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSold((prev) => new Set([...prev, ...res.soldIds]));
      toast.success(
        t('inventory.soldToast', {
          count: res.soldCount,
          gems: t('gems.amount', { count: res.total }),
        }),
      );
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const unsoldIds =
    result?.results.filter((r) => !sold.has(r.userItemId)).map((r) => r.userItemId) ?? [];
  const resultValue =
    result?.results.filter((r) => !sold.has(r.userItemId)).reduce((s, r) => s + r.item.price, 0) ??
    0;

  // Строка под кнопкой: причина недоступности, нехватка средств, остаток тиража или подсказка. Подарок (бонусные
  // открытия, «Открыть бесплатно») открывает один кейс по праву, без гемов, и при нехватке баланса; «Открыть за N»
  // бонус не тратит: не хватает гемов — открывает пополнение.
  let info: { text: ReactNode; tone: 'muted' | 'error' } | null = null;
  if (blocked) {
    const why =
      reason === 'LEVEL'
        ? t('case.levelRequired', { level: a.levelRequired ?? 0 })
        : reason === 'SOLD_OUT'
          ? t('case.soldOut')
          : reason === 'ADULT'
            ? t('case.adultRequired')
            : reason === 'COOLDOWN'
              ? t('case.cooldown')
              : t('case.unavailable');
    info = {
      tone: 'muted',
      text:
        reason === 'COOLDOWN' && a.availableAt ? (
          <>
            {why}{' '}
            <Countdown
              to={a.availableAt}
              className="tabular"
              onDone={() => void detail.refetch()}
            />
          </>
        ) : (
          why
        ),
    };
  } else if (insufficient && phone && a.freeOpens > 0) {
    // Телефон: гемов не хватает, но подарок (бонусное открытие) открывает кейс сейчас же — красное «Недостаточно
    // средств» (оно про кнопку открытия за гемы) читалось бы как «открыть нельзя». Видно число бонусных открытий,
    // как без нехватки; о нехватке говорят красная кнопка (нажатие — пополнение) и для читалок скрытый текст.
    info = {
      tone: 'muted',
      text: (
        <>
          <span className="sr-only">{t('case.insufficient')}.</span>{' '}
          {t('case.bonusCount', { count: a.freeOpens })}
        </>
      ),
    };
  } else if (insufficient) {
    info = { tone: 'error', text: t('case.insufficient') };
  } else if (supply) {
    info = {
      tone: 'muted',
      text: t('case.supply', { left: supply.total - supply.used, total: supply.total }),
    };
  } else if (me.data && a.freeOpens > 0 && !free) {
    // Поясняет кнопку с подарком рядом с «Быстро».
    info = { tone: 'muted', text: t('case.bonusCount', { count: a.freeOpens }) };
  } else if (!signedIn && !me.isLoading && c.minLevel) {
    info = { tone: 'muted', text: t('case.levelRequired', { level: c.minLevel }) };
  } else if (free && c.cooldownSeconds) {
    info = {
      tone: 'muted',
      text: t('case.everyHours', { hours: Math.round(c.cooldownSeconds / 3600) }),
    };
  }

  const openLabel = free ? (
    <span>{t('case.openFree')}</span>
  ) : (
    <span>
      {t('case.openFor')} <span className="case-open__sum">{formatGems(total)}</span>
    </span>
  );
  const fastOn = prefsHydrated && fast;
  /**
   * Окно результата на телефоне: по шкале телефона — Modal phoneScale, кнопки size="phone", выигрыш карточками
   * 108×72. По текущей ширине окна, а не по месту прокрутки: после поворота окно перерисовывается в нужной шкале.
   */
  const phoneResult = phone;
  const resultCount = result?.results.length ?? 0;
  /** Карточек в ряду окна на телефоне: до трёх; ширина — 108, уже 360 меньше (поля окна 12, зазор 6). */
  const resultCols = Math.min(3, resultCount);

  return (
    <section
      className="case-stage"
      aria-labelledby={`${infoId}-name`}
      data-testid="case-stage"
      data-count={openCount}
      data-phase={phase}
    >
      <h1 id={`${infoId}-name`} className="case-stage__name" data-testid="case-name">
        {c.name}
      </h1>

      {/* Рулетка сцены — только в раскладке планшета и десктопа: в полосе 120 телефона её геометрия чужая. */}
      <div className="case-band" data-testid="case-band">
        {phase === 'idle' || !result || spinPlace === 'strip' || phone ? (
          <CaseStageIdle
            game={game}
            name={c.name}
            imageUrl={c.imageUrl}
            count={openCount}
            neighbours={neighbours}
            // Во время запроса и прокрутки уйти на соседний кейс нельзя: показ выигрыша не потеряется.
            inert={spinning || busy}
          />
        ) : (
          <CaseRoulette
            pool={c.items}
            winners={result.results.map((r) => r.item)}
            spinId={spinId}
            fast={fast || settleNow}
            onLaneDone={onLaneDone}
          />
        )}
      </div>

      {/*
        Порядок в разметке = порядок фокуса во всех раскладках: количество → «Быстро» (подарок) →
        открытие. На десктопе кнопки стоят в колонках сетки (открытие — по центру), ниже десктопа —
        рядами в том же порядке, на телефоне — x1…x5 и «Быстро» одним рядом, без перестановки через CSS.
      */}
      <div className="case-controls" data-spinning={spinning ? '' : undefined}>
        {!free && c.maxOpenCount > 1 ? (
          <div className="case-controls__counts" role="group" aria-label={t('case.count')}>
            {Array.from({ length: c.maxOpenCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className="case-count"
                aria-pressed={count === n}
                disabled={spinning || busy}
                onClick={() => chooseCount(n)}
                data-testid={`case-count-${n}`}
              >
                <span>x{n}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="case-controls__extra">
          <button
            type="button"
            className="case-toggle"
            aria-pressed={fastOn}
            disabled={spinning}
            onClick={() => setFast(!fast)}
            data-testid="case-fast"
          >
            <FastIcon className="shrink-0" />
            <span>{t('case.fast')}</span>
          </button>
          {/* Подарок — отдельной группой: на планшете «Быстро» стоит по центру, он — справа. */}
          <div className="case-controls__more">
            {me.data && a.freeOpens > 0 && !free ? (
              <button
                type="button"
                className="case-toggle case-toggle--on"
                aria-disabled={spinning || busy || undefined}
                onClick={() => {
                  if (!spinning && !busy) void open(true);
                }}
                aria-label={`${t('case.openBonus')}: ${t('case.bonusCount', { count: a.freeOpens })}`}
                title={t('case.bonusCount', { count: a.freeOpens })}
                data-testid="case-open-bonus"
              >
                <GiftIcon className="shrink-0" />
                <span>{a.freeOpens}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="case-controls__main">
          {signedIn || loading ? (
            <button
              ref={openRef}
              type="button"
              className="case-open"
              data-state={openState}
              aria-disabled={openInactive || undefined}
              aria-busy={busy || undefined}
              aria-describedby={info ? infoId : undefined}
              onClick={() => {
                if (!openInactive) void open(false);
              }}
              data-testid="case-open"
            >
              <OpenIcon className="shrink-0" />
              {openLabel}
            </button>
          ) : (
            <button
              ref={openRef}
              type="button"
              className="case-open"
              data-state={blocked ? 'blocked' : 'ready'}
              aria-disabled={blocked || undefined}
              aria-describedby={info ? infoId : undefined}
              title={blocked ? undefined : t('case.loginToOpen')}
              onClick={() => {
                if (!blocked) openLogin();
              }}
              data-testid="case-open-login"
            >
              <OpenIcon className="shrink-0" />
              {openLabel}
            </button>
          )}
          <p
            id={infoId}
            className="case-info"
            data-tone={info?.tone}
            // Обратный отсчёт меняется каждую секунду — его не зачитываем, он есть в описании кнопки.
            aria-live={blocked && reason === 'COOLDOWN' ? 'off' : 'polite'}
            data-testid="case-info"
          >
            {info?.text}
          </p>
        </div>
      </div>

      <CaseStrip
        ref={stripRef}
        pool={c.items}
        count={openCount}
        winners={stripWinners}
        spinId={spinId}
        fast={fast || settleNow}
        onLaneDone={onLaneDone}
      />

      <Modal
        open={phase === 'result' && Boolean(result)}
        onOpenChange={(v) => !v && closeResult()}
        title={t('case.resultTitle', { count: result?.results.length ?? 1 })}
        // На телефоне выигрыш — карточки 108: окну с 640 (по центру) хватает ширины md.
        size={!phoneResult && resultCount > 2 ? 'lg' : 'md'}
        phoneScale={phoneResult}
        returnFocusRef={openRef}
      >
        {result && (
          <div className={phoneResult ? 'flex flex-col gap-3' : 'space-y-5'}>
            {phoneResult ? (
              // Телефон: карточки 108×72, как в содержимом кейса (без шанса), до трёх в ряд через 6 (список не
              // шире 3 · 108 + 2 · 6 = 336, по центру), неполный ряд — по центру. Под каждой — «Продать» (иконка
              // 12, через 12 — Medium 12, как в кнопках окна) или «Продано»; область нажатия — 28 (строка 12 и
              // по 8 сверху и снизу). Ширина карточки — от списка в cqw: с процентами Chromium теряет 1/64 px
              // (107.98 вместо 108).
              <ul className="@container mx-auto flex w-full max-w-[336px] flex-wrap justify-center gap-x-[6px] gap-y-3">
                {result.results.map((r) => (
                  <li
                    key={r.userItemId}
                    className="flex flex-col items-center gap-2"
                    style={{
                      width: `min(108px, calc((100cqw - ${(resultCols - 1) * 6}px) / ${resultCols}))`,
                    }}
                  >
                    <SkinCard
                      item={r.item}
                      className={cn('skin-card--m w-full', sold.has(r.userItemId) && 'opacity-40')}
                      data-testid="result-item"
                    />
                    {sold.has(r.userItemId) ? (
                      // Высота 12, как у строки «Продать» с иконкой: текст на той же линии, окно не прыгает.
                      <span className="inline-flex h-3 items-center text-[12px] font-medium text-white/50">
                        {t('case.sold')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="-my-2 inline-flex items-center gap-3 py-2 text-[12px] font-medium text-white/50 transition-colors hover:text-lime"
                        onClick={() => void sell([r.userItemId])}
                      >
                        <Coins size={12} aria-hidden="true" /> {t('case.sellOne')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div
                className={cn(
                  'grid gap-2.5',
                  result.results.length > 2 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2',
                )}
              >
                {result.results.map((r) => (
                  <ItemTile
                    key={r.userItemId}
                    item={r.item}
                    stLabel={t('items.stattrakBadge')}
                    svLabel={t('items.souvenirBadge')}
                    dimmed={sold.has(r.userItemId)}
                    footer={
                      sold.has(r.userItemId) ? (
                        <span className="mt-2 text-[11px] font-semibold uppercase text-dim">
                          {t('case.sold')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase text-dim hover:text-accent"
                          onClick={() => void sell([r.userItemId])}
                        >
                          <Coins size={12} /> {t('case.sellOne')}
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            )}
            <div
              className={cn(
                'flex items-center justify-between',
                phoneResult ? 'text-[12px] font-medium' : 'text-sm',
              )}
            >
              <span className={phoneResult ? 'text-white/50' : 'text-muted'}>
                {t('case.total')}
              </span>
              {/* Телефон: лайм сайта #B7FF00, как цены на карточках окна; гем 8×12, через 6 — цифры (как в шапке). */}
              <GemAmount
                value={resultValue}
                size={phoneResult ? 'xs' : 'lg'}
                className={phoneResult ? 'gap-[6px] text-lime' : 'text-accent'}
              />
            </div>
            {/* «Продать всё за N» — во всю ширину: в три колонки подписи не помещались и переносились. */}
            <div
              className={
                phoneResult ? 'grid gap-[6px] sm:grid-cols-2' : 'grid gap-2 sm:grid-cols-2'
              }
            >
              <Button
                variant="secondary"
                size={phoneResult ? 'phone' : 'md'}
                className="whitespace-nowrap sm:col-span-2"
                disabled={!unsoldIds.length}
                onClick={() => void sell(unsoldIds)}
                data-testid="result-sell-all"
              >
                {phoneResult ? (
                  // Зазор кнопки телефона (12) — между иконкой и текстом; сумма к тексту ближе — через 6,
                  // гем → цифры — тоже 6.
                  <span className="inline-flex items-center gap-[6px]">
                    {t('case.sellAll')}{' '}
                    <GemAmount value={resultValue} size="xs" className="gap-[6px]" />
                  </span>
                ) : (
                  <>
                    {t('case.sellAll')} <GemAmount value={resultValue} size="sm" />
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                size={phoneResult ? 'phone' : 'md'}
                className="whitespace-nowrap"
                onClick={closeResult}
              >
                {t('case.keep')}
              </Button>
              {/* Телефон: лайм сайта #B7FF00, как у кнопки «Открыть» страницы (primary окна — #C6FF00). */}
              <Button
                size={phoneResult ? 'phone' : 'md'}
                className={cn(
                  'whitespace-nowrap',
                  phoneResult && 'bg-lime hover:bg-lime hover:brightness-110',
                )}
                onClick={() => {
                  closeResult();
                  void open();
                }}
                disabled={blocked || free}
                data-testid="result-open-again"
              >
                <RotateCcw size={phoneResult ? 12 : 16} /> {t('case.openAgain')}
              </Button>
            </div>
            <Link
              href={`/provably-fair?opening=${result.results[0]?.openingId ?? ''}`}
              className={cn(
                'flex items-center justify-center gap-2 text-xs text-dim hover:text-text',
                // Телефон: Medium 12, иконка 12, через 12 — текст; область нажатия 28 (по 8 сверху и снизу) при
                // прежнем зазоре 12 над ссылкой.
                phoneResult && '-my-2 gap-3 py-2 font-medium',
              )}
            >
              <ShieldCheck size={phoneResult ? 12 : 14} /> {t('case.fair')}
            </Link>
          </div>
        )}
      </Modal>
    </section>
  );
}
