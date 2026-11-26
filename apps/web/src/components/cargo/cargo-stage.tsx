'use client';

import {
  WS_EVENTS,
  WS_ROOMS,
  formatGems,
  type CargoBuyResultDto,
  type CargoDetailDto,
  type CargoResultDto,
  type CargoResultEventDto,
  type CargoRoundEventDto,
  type CargoSeatsEventDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CargoIcon, GemIcon, OpenIcon } from '@/components/icons/design-icons';
import { SkinCard } from '@/components/items/skin-card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import {
  cargoChance,
  cargoImageSrcSet,
  clampCount,
  formatSeatRanges,
  mergeSeats,
  randomClientSeed,
  type CargoNeighbours,
} from '@/lib/cargo-page';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { prefersReducedMotion } from '@/lib/motion';
import { useInvalidateWallet } from '@/lib/queries';
import { noteServerTime, useRoom, useSocketEvent } from '@/lib/socket';
import { sound } from '@/lib/sound';
import { useUi } from '@/lib/store';
import { CargoArrow } from './cargo-arrow';
import { CargoHow } from './cargo-how';
import { CargoQuantity } from './cargo-quantity';
import { CargoResult } from './cargo-result';
import { CargoTimer } from './cargo-timer';

/**
 * Сцена: покой → closing (таймер дошёл до нуля, ждём приземления) → landing (груз «садится», 1,2 с) →
 * result (окно результата — только участнику) → снова покой.
 */
type Phase = 'idle' | 'closing' | 'landing' | 'result';

/**
 * Состояние кнопки покупки (как у «Открыть» на странице кейса): ready — #B7FF00 (гостю — вход),
 * insufficient — #FF2529 (откроется пополнение), blocked — #26262F (купить нельзя: распродано,
 * приземляется, условия), loading — пока неизвестно, вошёл ли игрок и что ему доступно.
 */
type BuyState = 'ready' | 'insufficient' | 'blocked' | 'loading';

/** Строка под кнопкой: текст, тон и (для своих мест и итога раунда) ссылка на проверку. */
interface Info {
  text: string;
  tone?: 'muted' | 'error';
  verifyHref?: string;
}

/** Показанный итог раунда: участник видит окно, остальные — строку под кнопкой. */
interface Shown {
  result: CargoResultDto;
  participant: boolean;
  won: boolean;
  note: Info | null;
}

const LANDING_MS = 1200;
const NOTE_MS = 10_000;
/** Опрос, пока груз приземляется: шаг редеет, чтобы сотни вкладок не опрашивали API раз в 3 с. */
const CLOSING_POLL_MS = [3000, 6000, 12000, 30000];
/** После этих отказов данные груза устарели — перечитываем (свободные места, раунд, лимит, условия). */
const STALE_ERRORS = new Set([
  'CARGO_SEATS_LEFT',
  'CARGO_ROUND_CLOSED',
  'CARGO_LIMIT_REACHED',
  'CARGO_CONDITIONS_NOT_MET',
]);

/**
 * Страница груза (макет 1920): название и «Упадёт через», таймер поверх купола, груз на парашюте над
 * помостом со стрелками к соседним грузам, под ящиком — плашка цены места и выбор количества,
 * «Доступно мест», тень на помосте, кнопка покупки со строкой под ней; слева «Как это работает?»,
 * справа «Супер-приз:» с карточкой приза. Сервер решает всё; страница показывает места, раунды и
 * итоги по сокету (комната грузов игры) и по таймеру.
 */
export function CargoStage({
  game,
  initial,
  neighbours,
}: {
  game: string;
  initial: CargoDetailDto;
  neighbours: CargoNeighbours | null;
}) {
  const t = useTranslations();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidateWallet = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);
  const titleId = useId();
  const infoId = useId();
  /** Кнопка покупки: на неё возвращается фокус после окна результата. */
  const buyRef = useRef<HTMLButtonElement>(null);
  const slug = initial.slug;

  // Детальная страницы — без кэша (часы таймера ставятся по ней); свежие ответы сверяют часы снова.
  useEffect(() => noteServerTime(initial.serverTime), [initial.serverTime]);

  const detail = useQuery({
    queryKey: ['cargo', game, slug, me.data?.id ?? 'guest'],
    queryFn: async () => {
      const r = await api.get<CargoDetailDto>(`/games/${game}/cargo/${slug}`);
      noteServerTime(r.serverTime);
      return r;
    },
    // Гостю сразу показываем данные страницы и перечитываем; вошедшему нужна своя доступность.
    initialData: me.data ? undefined : initial,
    initialDataUpdatedAt: 0,
    enabled: !me.isLoading,
    // Груз выключили, пока страница открыта, — повторять незачем.
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });
  const { refetch } = detail;
  const gone = detail.error instanceof ApiError && detail.error.code === 'CARGO_NOT_FOUND';
  const d = detail.data ?? initial;
  const round = d.round;
  const roundId = round?.id ?? null;
  const a = d.availability;
  const free = d.isFree;
  const signedIn = Boolean(me.data);
  const meShortId = me.data?.shortId ?? null;
  const reason = a.reason;
  const maxBuy = round ? a.maxBuy : 0;

  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState<Shown | null>(null);
  const [note, setNote] = useState<Info | null>(null);
  /** Итоги, которые уже показаны (сокет, ответ покупки и опрос могут принести один и тот же). */
  const shownRounds = useRef(new Set<string>());
  /** Раунд, чей срок вышел: ждём его итога в фазе closing. */
  const closingRound = useRef<string | null>(null);
  /**
   * Места игрока по раундам: после приземления детальная перечитается (в новом раунде мест 0), а окну
   * результата нужны места показанного раунда.
   */
  const seatsByRound = useRef(new Map<string, number>());
  /**
   * Раунд, в котором сейчас идёт покупка, и итог этого раунда, пришедший по сокету раньше ответа: сервер
   * рассылает события сразу после коммита, и покупатель последнего места иначе увидел бы итог «зрителем»
   * (своих мест в раунде страница ещё не знает). Итог показывается по ответу покупки или после неё.
   */
  const buyingRound = useRef<string | null>(null);
  const deferredResult = useRef<CargoResultDto | null>(null);
  const mySeats = a.mySeats;
  useEffect(() => {
    if (roundId && signedIn) seatsByRound.current.set(roundId, mySeats);
  }, [roundId, signedIn, mySeats]);

  // Количество всегда в пределах 1…сколько можно взять (свободные, лимит); у бесплатного — одно место.
  const qty = free ? 1 : clampCount(count, maxBuy);
  const changeCount = (n: number) => {
    setNote(null);
    setCount(n);
  };

  const showResult = useCallback(
    (r: CargoResultDto, seats?: number) => {
      if (shownRounds.current.has(r.roundId)) return;
      shownRounds.current.add(r.roundId);
      if (closingRound.current === r.roundId) closingRound.current = null;
      // Раунд закрыт — у шаблона новый раунд (или его нет): доступность перечитываем.
      void qc.invalidateQueries({ queryKey: ['cargo', game, slug] });
      const mine = seats ?? seatsByRound.current.get(r.roundId) ?? 0;
      const won = meShortId !== null && r.winner?.shortId === meShortId;
      const participant = mine > 0 || won;
      // Не участник и мест не покупали — показывать нечего: сразу новый раунд.
      if (!participant && r.status === 'expired' && r.seatsSold === 0) {
        setPhase('idle');
        return;
      }
      const verifyHref = `/provably-fair?cargo=${r.roundId}`;
      const noteInfo: Info | null = participant
        ? null
        : {
            verifyHref,
            text:
              r.status === 'landed' && r.winner && r.winningSeat !== null
                ? t('cargo.result.note', {
                    nickname: r.winner.nickname,
                    seat: r.winningSeat,
                    sold: r.seatsSold,
                  })
                : r.status === 'cancelled'
                  ? t('cargo.result.noteCancelled')
                  : t('cargo.result.noteMin', { min: r.minSeatsToLand ?? 0 }),
          };
      setShown({ result: r, participant, won, note: noteInfo });
      if (!prefersReducedMotion()) {
        setPhase('landing');
        return;
      }
      // «Уменьшить движение»: без анимации — сразу окно (участнику) или строка под кнопкой.
      if (participant) {
        setPhase('result');
        if (won) sound.win(3);
        else sound.lose();
      } else {
        setPhase('idle');
        setNote(noteInfo);
      }
    },
    [qc, game, slug, meShortId, t],
  );

  // Груз «садится» 1,2 с, затем участнику — окно, остальным — строка под кнопкой (фокус не трогаем).
  useEffect(() => {
    if (phase !== 'landing' || !shown) return;
    const id = setTimeout(() => {
      if (shown.participant) {
        setPhase('result');
        if (shown.won) sound.win(3);
        else sound.lose();
      } else {
        setPhase('idle');
        setNote(shown.note);
      }
    }, LANDING_MS);
    return () => clearTimeout(id);
  }, [phase, shown]);

  // Строка с итогом чужого раунда держится 10 с.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  // Таймер дошёл до нуля — ждём приземления (событие сокета или опрос).
  const onTimerDone = useCallback(() => {
    if (!roundId) return;
    closingRound.current = roundId;
    setPhase((p) => (p === 'idle' ? 'closing' : p));
  }, [roundId]);

  // Опрос в фазе closing: 3 → 6 → 12 → 30 → 30… с (приземление могло застрять, §B.5).
  useEffect(() => {
    if (phase !== 'closing') return;
    let step = 0;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(
        () => {
          void refetch();
          step += 1;
          schedule();
        },
        CLOSING_POLL_MS[Math.min(step, CLOSING_POLL_MS.length - 1)],
      );
    };
    schedule();
    return () => clearTimeout(id);
  }, [phase, refetch]);

  // Раунд сменился, пока ждали: событие итога пропущено — берём итог из данных груза.
  const lastResult = d.lastResult;
  useEffect(() => {
    const closing = closingRound.current;
    if (phase !== 'closing' || !closing || roundId === closing) return;
    closingRound.current = null;
    if (lastResult?.roundId === closing) showResult(lastResult);
    else setPhase('idle');
  }, [phase, roundId, lastResult, showResult]);

  const detailFilter = { queryKey: ['cargo', game, slug] };
  useRoom(WS_ROOMS.cargo(game));
  useSocketEvent<CargoSeatsEventDto>(WS_EVENTS.cargoSeats, (e) => {
    if (e.templateId !== d.id) return;
    qc.setQueriesData<CargoDetailDto>(detailFilter, (x) => (x ? mergeSeats(x, e) : x));
  });
  useSocketEvent<CargoResultEventDto>(WS_EVENTS.cargoResult, (e) => {
    if (e.result.templateId !== d.id) return;
    if (buyingRound.current === e.result.roundId) deferredResult.current = e.result;
    else showResult(e.result);
  });
  // Новый раунд: у него своя доступность (лимит, условия) — перечитываем.
  useSocketEvent<CargoRoundEventDto>(WS_EVENTS.cargoRound, (e) => {
    if (e.templateId === d.id) void qc.invalidateQueries(detailFilter);
  });
  useSocketEvent('connect', () => void refetch());

  // Вошёл, но доступность для него ещё не пришла (на руках гостевая) — ждём, а не пугаем «нельзя».
  // Не пришла совсем (ошибка запроса) — не ждём и не запрещаем: при покупке всё равно решит сервер.
  const loading = me.isLoading || (signedIn && reason === 'LOGIN' && !detail.isError);
  // Распродано, приземляется и нет раунда — нельзя и гостю; остальное сервер решает для вошедшего.
  const blocked =
    phase !== 'idle' ||
    !round ||
    (signedIn
      ? !loading && reason !== null && reason !== 'LOGIN'
      : reason === 'SOLD_OUT' || reason === 'CLOSED' || reason === 'UNAVAILABLE');
  const total = round ? round.seatPrice * qty : 0;
  const insufficient = Boolean(me.data && !loading && !blocked && !free && me.data.balance < total);
  const buyState: BuyState = loading
    ? 'loading'
    : blocked
      ? 'blocked'
      : insufficient
        ? 'insufficient'
        : 'ready';
  // Нажать нельзя, но кнопка держит фокус (aria-disabled, а не disabled).
  const buyInactive = buyState === 'loading' || buyState === 'blocked' || busy;
  const qtyDisabled = !round || maxBuy <= 0 || phase !== 'idle';

  const onBuy = async () => {
    setNote(null);
    if (buyInactive) return;
    if (!me.data) return openLogin();
    if (insufficient) return openDeposit();
    if (!round) return;
    setBusy(true);
    buyingRound.current = round.id;
    try {
      const res = await api.post<CargoBuyResultDto>(
        `/games/${game}/cargo/${slug}/buy`,
        { roundId: round.id, count: qty, clientSeed: randomClientSeed() },
        { idempotencyKey: newIdempotencyKey() },
      );
      qc.setQueriesData<CargoDetailDto>(detailFilter, (x) => {
        if (!x?.round || x.round.id !== res.roundId) return x;
        // Пока шёл ответ, сокет мог принести чужие покупки — проданных мест не меньше известного.
        const seatsSold = Math.max(res.round.seatsSold, x.round.seatsSold);
        return { ...x, round: { ...res.round, seatsSold }, availability: res.availability };
      });
      invalidateWallet();
      toast.success(t('cargo.bought', { count: res.count, from: res.seatFrom, to: res.seatTo }));
      // Эта покупка заняла последнее место — груз приземлился в той же транзакции.
      if (res.result) showResult(res.result, res.availability.mySeats);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        toast.error(t('cargo.notEnough'));
        openDeposit();
      } else {
        toast.error(errorText(err));
        if (err instanceof ApiError && STALE_ERRORS.has(err.code)) void refetch();
      }
    } finally {
      setBusy(false);
      buyingRound.current = null;
      // Итог пришёл по сокету во время покупки: показан по ответу — повтор отсеется; покупка не прошла —
      // показываем по местам, которые страница уже знает (нет мест — строкой для зрителя).
      const deferred = deferredResult.current;
      deferredResult.current = null;
      if (deferred) showResult(deferred);
    }
  };

  // Строка под кнопкой: первое подходящее.
  let info: Info | null = null;
  if (note) info = note;
  else if (loading) info = null;
  else if (phase !== 'idle' || reason === 'SOLD_OUT' || reason === 'CLOSED')
    info = { text: t('cargo.landing') };
  else if (!round)
    info = { text: t(d.noRound === 'PRIZE_UNAVAILABLE' ? 'cargo.paused' : 'cargo.unavailable') };
  else if (reason === 'ADULT') info = { text: t('cargo.adultRequired') };
  else if (reason === 'LEVEL')
    info = { text: t('cargo.levelRequired', { level: round.minLevel ?? 0 }) };
  else if (reason === 'NO_DEPOSIT')
    info = { text: t('cargo.depositRequired', { days: round.depositWithinDays ?? 0 }) };
  else if (reason === 'LIMIT') info = { text: t('cargo.limitReached', { count: mySeats }) };
  else if (insufficient) info = { text: t('cargo.insufficient'), tone: 'error' };
  else if (mySeats > 0) {
    const ranges = formatSeatRanges(a.myPurchases);
    info = {
      text: t('cargo.mySeats', { count: mySeats, ranges: ranges.text, more: ranges.more }),
      // Хэш раунда и свои покупки с seed'ами видны на проверке ещё до приземления (D5).
      verifyHref: `/provably-fair?cargo=${round.id}`,
    };
  } else if (round.minSeatsToLand && round.seatsSold < round.minSeatsToLand)
    info = {
      text: t('cargo.minSeats', { min: round.minSeatsToLand, kind: free ? 'free' : 'paid' }),
    };
  // Гостю условия участия видны заранее — те же тексты, что у вошедшего.
  else if (!signedIn && round.minLevel)
    info = { text: t('cargo.levelRequired', { level: round.minLevel }) };
  else if (!signedIn && round.depositWithinDays)
    info = { text: t('cargo.depositRequired', { days: round.depositWithinDays }) };

  const result = (
    <CargoResult
      game={game}
      result={shown?.result ?? null}
      meShortId={meShortId}
      open={phase === 'result' && Boolean(shown?.participant)}
      onClose={() => {
        setPhase('idle');
        setShown(null);
      }}
      returnFocusRef={buyRef}
    />
  );

  if (gone)
    return (
      <section className="cargo-stage" data-testid="cargo-stage">
        <div className="mt-10" data-testid="cargo-gone">
          <EmptyState
            icon={<CargoIcon size={40} />}
            text={t('cargo.gone')}
            action={
              <Link href={`/${game}/cargo`} className="text-accent underline underline-offset-4">
                {t('cargo.toList')}
              </Link>
            }
          />
        </div>
        {result}
      </section>
    );

  const chance = round ? cargoChance(mySeats, maxBuy > 0 ? qty : 0, round.seatsTotal) : null;

  return (
    <section className="cargo-stage" aria-labelledby={titleId} data-testid="cargo-stage">
      <div className="cargo-stage__inner" data-phase={phase}>
        <h1 id={titleId} className="cargo-title" data-testid="cargo-title">
          {d.name}
        </h1>
        <p className="cargo-subtitle">{t('cargo.fallsIn')}</p>

        <div className="cargo-scene">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={d.imageUrl}
            srcSet={cargoImageSrcSet(d.imageUrl)}
            sizes="(max-width: 623px) min(400px, 100vw), (max-width: 1039px) 558px, 744px"
            alt=""
            width={744}
            height={744}
            className="cargo-image"
            fetchPriority="high"
            draggable={false}
            data-testid="cargo-image"
          />
          <CargoTimer endsAt={round?.endsAt ?? null} onDone={onTimerDone} />
          {neighbours ? (
            <>
              <CargoArrow
                side="prev"
                href={`/${game}/cargo/${neighbours.prev.slug}`}
                label={t('cargo.prev', { name: neighbours.prev.name })}
              />
              <CargoArrow
                side="next"
                href={`/${game}/cargo/${neighbours.next.slug}`}
                label={t('cargo.next', { name: neighbours.next.name })}
              />
            </>
          ) : null}
        </div>

        <div className="cargo-controls">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/design/cargo-scene.webp"
            alt=""
            aria-hidden="true"
            className="cargo-backdrop"
            draggable={false}
          />
          <span className="cargo-shadow" aria-hidden="true" />
          {/* Без раунда плашек нет, но их место держится — кнопка не прыгает. */}
          <div className="cargo-badges" role="group" aria-label={t('cargo.count')}>
            {round ? (
              <>
                <span
                  className={cn('cargo-price', free ? 'shape' : 'cargo-shape-tl')}
                  data-testid="cargo-price"
                >
                  {free ? (
                    <span>{t('cargo.free')}</span>
                  ) : (
                    <>
                      <GemIcon className="cargo-price__gem" />
                      <span aria-hidden="true">{formatGems(round.seatPrice)}</span>
                      <span className="sr-only">
                        {t('cargo.price', { gems: t('gems.amount', { count: round.seatPrice }) })}
                      </span>
                    </>
                  )}
                </span>
                {free ? null : (
                  <CargoQuantity
                    value={qty}
                    max={maxBuy}
                    disabled={qtyDisabled}
                    onChange={changeCount}
                  />
                )}
              </>
            ) : null}
          </div>
          <p className="cargo-available" data-testid="cargo-available">
            {round
              ? t('cargo.available', {
                  left: formatGems(Math.max(0, round.seatsTotal - round.seatsSold)),
                  total: formatGems(round.seatsTotal),
                })
              : null}
          </p>
          <button
            ref={buyRef}
            type="button"
            className="case-open cargo-buy"
            data-state={buyState}
            aria-disabled={buyInactive || undefined}
            aria-busy={busy || undefined}
            aria-describedby={info ? infoId : undefined}
            onClick={() => void onBuy()}
            data-testid={signedIn || loading ? 'cargo-buy' : 'cargo-buy-login'}
            title={signedIn || loading || blocked ? undefined : t('cargo.loginToBuy')}
          >
            <OpenIcon className="shrink-0" />
            {free ? (
              <span>{t('cargo.joinFree')}</span>
            ) : (
              <span>
                {t('cargo.buyFor', { count: qty })}{' '}
                <span className="cargo-buy__sum">{formatGems(total)}</span>
              </span>
            )}
          </button>
          <p
            id={infoId}
            className="case-info cargo-info"
            data-tone={info?.tone}
            aria-live="polite"
            data-testid="cargo-info"
          >
            {info?.text}
            {info?.verifyHref ? (
              <>
                {' '}
                <Link
                  href={info.verifyHref}
                  className="cargo-info__link"
                  data-testid="cargo-info-verify"
                >
                  {t('cargo.verifyShort')}
                </Link>
              </>
            ) : null}
          </p>
        </div>

        {/* Порядок DOM = порядок чтения и фокуса: «Как это работает?» (слева на макете), затем приз. */}
        <div className="cargo-side">
          <CargoHow roundId={roundId} />
          {round ? (
            <div className="cargo-prize" data-testid="cargo-prize-block">
              <h2 className="cargo-prize__title">{t('cargo.superPrize')}</h2>
              <SkinCard
                item={round.prize}
                chance={chance}
                href={`/${game}/items/${round.prize.id}`}
                className="cargo-prize__card"
                data-testid="cargo-prize"
              />
            </div>
          ) : null}
        </div>
      </div>
      {result}
    </section>
  );
}
