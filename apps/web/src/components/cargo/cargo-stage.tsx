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
  cargoParticipant,
  cargoWide,
  clampCount,
  formatSeatRanges,
  mergeBuyResult,
  mergeSeats,
  missedResult,
  randomClientSeed,
  seatsKey,
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

/** Показанный итог раунда: участник видит окно, остальные — строку под кнопкой (note). */
interface Shown {
  result: CargoResultDto;
  /** null — пока неизвестно: своих мест в раунде страница не знает, ждём данных груза (cargoParticipant). */
  participant: boolean | null;
  won: boolean;
  note: Info;
  /** Для кого решали: null — гость. */
  userId: string | null;
}

const LANDING_MS = 1200;
const NOTE_MS = 10_000;
/** Сколько ждать данных груза, чтобы узнать места игрока (купленные в другой вкладке); дальше — как зрителю. */
const PARTICIPANT_WAIT_MS = 5000;
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
  const userId = me.data?.id ?? null;
  /** Данные груза — свои у каждого игрока (доступность, места) и у гостя. */
  const keyOf = useCallback(
    (id: string | null) => ['cargo', game, slug, id ?? 'guest'],
    [game, slug],
  );
  /**
   * Игрок сейчас — для обработчиков из прежних замыканий (ответ покупки, отложенный итог): выход и вход
   * другого игрока идут без перезагрузки страницы.
   */
  const userRef = useRef<{ id: string; shortId: number } | null>(null);
  userRef.current = me.data ? { id: me.data.id, shortId: me.data.shortId } : null;

  // Детальная страницы — без кэша (часы таймера ставятся по ней); свежие ответы сверяют часы снова.
  useEffect(() => noteServerTime(initial.serverTime), [initial.serverTime]);

  const detail = useQuery({
    queryKey: keyOf(userId),
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
   * Места по игроку и раунду (seatsKey): после приземления детальная перечитается (в новом раунде мест 0), а
   * окну результата нужны места показанного раунда — того игрока, что на странице сейчас.
   */
  const seatsByRound = useRef(new Map<string, number>());
  /** Начало посадки груза: окно или строка — через LANDING_MS от него, даже если участие ещё выяснялось. */
  const landingAt = useRef(0);
  /** Номер показанного итога: данные груза, пришедшие для прежнего итога, уже не нужны. */
  const showSeq = useRef(0);
  /** Раунды, которые страница показывала: итог такого раунда в данных груза без события — пропущенный. */
  const seenRounds = useRef(new Set<string>());
  /**
   * Раунд, в котором сейчас идёт покупка, и итог этого раунда, пришедший по сокету раньше ответа: сервер
   * рассылает события сразу после коммита, и покупатель последнего места иначе увидел бы итог «зрителем»
   * (своих мест в раунде страница ещё не знает). Итог показывается по ответу покупки или после неё.
   */
  const buyingRound = useRef<string | null>(null);
  const deferredResult = useRef<CargoResultDto | null>(null);
  const mySeats = a.mySeats;
  // Места — только из данных груза этого игрока: у вошедшего, пока его данные не пришли, на руках гостевые.
  const ownSeats = userId && detail.data ? mySeats : null;
  useEffect(() => {
    if (!roundId) return;
    seenRounds.current.add(roundId);
    if (userId && ownSeats !== null) seatsByRound.current.set(seatsKey(userId, roundId), ownSeats);
  }, [roundId, userId, ownSeats]);

  // Количество всегда в пределах 1…сколько можно взять (свободные, лимит); у бесплатного — одно место.
  const qty = free ? 1 : clampCount(count, maxBuy);
  // Сколько можно взять, стало меньше (чужие покупки, лимит, приземление) — урезается и сам выбор: иначе в
  // новом раунде поле без действий игрока вернулось бы к прежнему, большему числу.
  useEffect(() => {
    setCount((c) => clampCount(c, maxBuy));
  }, [maxBuy]);
  const changeCount = (n: number) => {
    setNote(null);
    setCount(n);
  };

  /** Итог раскрыт: участнику — окно, остальным — строка под кнопкой (фокус не трогаем). */
  const reveal = useCallback((s: Shown) => {
    // Игрок сменился, пока груз садился (вышел, вошёл другой), — окно итога прежнего ему не показываем.
    if (s.participant && s.userId === (userRef.current?.id ?? null)) {
      setPhase('result');
      if (s.won) sound.win(3);
      else sound.lose();
    } else {
      setPhase('idle');
      setNote(s.note);
    }
  }, []);

  const showResult = useCallback(
    (r: CargoResultDto) => {
      if (shownRounds.current.has(r.roundId)) return;
      shownRounds.current.add(r.roundId);
      if (closingRound.current === r.roundId) closingRound.current = null;
      // Раунд закрыт — у шаблона новый раунд (или его нет): доступность перечитываем.
      const refreshed = qc.invalidateQueries({ queryKey: ['cargo', game, slug] });
      // Игрок — на момент итога: обработчик мог прийти из замыкания, созданного до выхода или входа другого.
      const user = userRef.current;
      const key = keyOf(user?.id ?? null);
      const participantBy = (server: CargoDetailDto | undefined) =>
        cargoParticipant(
          r,
          user?.shortId ?? null,
          user ? (seatsByRound.current.get(seatsKey(user.id, r.roundId)) ?? 0) : 0,
          server,
        );
      // Данные груза уже с этим итогом (опрос после срока, пропущенный итог) — места игрока в них.
      const participant = participantBy(qc.getQueryData<CargoDetailDto>(key));
      // Не участник и мест не покупали — показывать нечего: сразу новый раунд.
      if (participant === false && r.status === 'expired' && r.seatsSold === 0) {
        setPhase('idle');
        return;
      }
      const s: Shown = {
        result: r,
        participant,
        won: user !== null && r.winner?.shortId === user.shortId,
        userId: user?.id ?? null,
        note: {
          verifyHref: `/provably-fair?cargo=${r.roundId}`,
          text:
            r.status === 'landed' && r.winner && r.winningSeat !== null
              ? t('cargo.result.note', {
                  nickname: r.winner.nickname,
                  seat: r.winningSeat,
                  sold: r.seatsSold,
                })
              : r.status === 'cancelled'
                ? // Без возврата — бесплатный груз или отмена до первой покупки.
                  t(
                    r.refunded
                      ? 'cargo.result.noteCancelled'
                      : 'cargo.result.noteCancelledNoRefund',
                  )
                : t('cargo.result.noteMin', { min: r.minSeatsToLand ?? 0 }),
        },
      };
      const seq = ++showSeq.current;
      setShown(s);
      const reduced = prefersReducedMotion();
      if (!reduced) {
        // Груз садится сразу; окно или строка — когда сядет и станет ясно, участник ли игрок (эффект ниже).
        landingAt.current = Date.now();
        setPhase('landing');
      } else if (participant !== null) {
        // «Уменьшить движение»: без анимации — сразу окно (участнику) или строка под кнопкой.
        reveal(s);
      } else {
        // Без анимации ждём данных груза в фазе closing: кнопка неактивна, «Груз приземляется…».
        setPhase('closing');
      }
      if (participant !== null) return;
      // Своих мест в раунде страница не знает, но их могли купить в другой вкладке: решают данные груза
      // (lastResultMySeats), когда перечитаются; не пришли за PARTICIPANT_WAIT_MS — как зрителю.
      const wait = new Promise((ok) => setTimeout(ok, PARTICIPANT_WAIT_MS));
      void Promise.race([refreshed, wait]).then(() => {
        if (showSeq.current !== seq) return;
        const same = userRef.current?.id === user?.id;
        const fresh = same ? qc.getQueryData<CargoDetailDto>(key) : undefined;
        const next = { ...s, participant: (same && participantBy(fresh)) || false };
        setShown(next);
        if (reduced) reveal(next);
      });
    },
    [qc, game, slug, keyOf, reveal, t],
  );

  // Груз «садится» 1,2 с с начала посадки, затем — итог (reveal). Пока выясняется, участник ли игрок, — ждём.
  useEffect(() => {
    if (phase !== 'landing' || !shown || shown.participant === null) return;
    const left = Math.max(0, landingAt.current + LANDING_MS - Date.now());
    const id = setTimeout(() => reveal(shown), left);
    return () => clearTimeout(id);
  }, [phase, shown, reveal]);

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

  // Раунд, который страница показывала, завершился без события итога (сокет лежал, телефон спал): после
  // переподключения итог берётся из данных груза — как если бы событие пришло.
  useEffect(() => {
    if (phase !== 'idle') return;
    const missed = missedResult(lastResult, seenRounds.current, shownRounds.current);
    if (!missed) return;
    if (buyingRound.current === missed.roundId) deferredResult.current ??= missed;
    else showResult(missed);
  }, [phase, lastResult, showResult]);

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
    // Покупатель — на момент нажатия: ответ может прийти уже после выхода (или входа другого игрока).
    const buyer = me.data.id;
    setBusy(true);
    buyingRound.current = round.id;
    try {
      const res = await api.post<CargoBuyResultDto>(
        `/games/${game}/cargo/${slug}/buy`,
        { roundId: round.id, count: qty, clientSeed: randomClientSeed() },
        { idempotencyKey: newIdempotencyKey() },
      );
      // Места этой покупки — сразу, а не эффектом после перерисовки: итог раунда может застать страницу
      // раньше (отложенный — в finally, по сокету — до эффекта), и участник без них увидел бы строку зрителя.
      seatsByRound.current.set(seatsKey(buyer, res.roundId), res.availability.mySeats);
      // Пока шёл ответ, сокет мог принести чужие покупки — они не теряются (см. mergeBuyResult). Доступность в
      // ответе — покупателя: только в его данные груза (не в гостевые — после выхода её увидел бы гость).
      qc.setQueryData<CargoDetailDto>(keyOf(buyer), (x) => (x ? mergeBuyResult(x, res) : x));
      invalidateWallet();
      toast.success(t('cargo.bought', { count: res.count, from: res.seatFrom, to: res.seatTo }));
      // Эта покупка заняла последнее место — груз приземлился в той же транзакции.
      if (res.result) showResult(res.result);
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
      // Итог пришёл во время покупки (по сокету или в данных груза): показан по ответу — повтор отсеется;
      // иначе — по местам, которые страница знает: с местами этой покупки, если она прошла (раунд распродал
      // другой игрок); покупка не прошла и мест нет — решают данные груза (места могли купить в другой вкладке).
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
        {/* Телефон (шкала 16 / 12 / 8): иконка 24, текст и ссылка 12; сверху 48 под шапкой, как у названия. */}
        <div className="mt-10 max-md:mt-0" data-testid="cargo-gone">
          <EmptyState
            icon={<CargoIcon size={40} className="max-md:size-6" />}
            text={t('cargo.gone')}
            className="max-md:[&_p]:text-[12px]"
            action={
              <Link
                href={`/${game}/cargo`}
                className="text-accent underline underline-offset-4 max-md:text-[12px] max-md:underline-offset-2"
              >
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
      <div
        className="cargo-stage__inner"
        data-phase={phase}
        data-wide={cargoWide(d.imageUrl) || undefined}
      >
        <h1 id={titleId} className="cargo-title" data-testid="cargo-title">
          {d.name}
        </h1>
        <p className="cargo-subtitle">{t('cargo.fallsIn')}</p>

        <div className="cargo-scene">
          {/* Ширина груза: телефон (< 48rem, как max-md:) — 372, планшет — 558, десктоп — 744. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={d.imageUrl}
            srcSet={cargoImageSrcSet(d.imageUrl)}
            sizes="(width < 48rem) 372px, (max-width: 1039px) 558px, 744px"
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
            ) : round ? (
              <span>
                {t('cargo.buyFor', { count: qty })}{' '}
                <span className="cargo-buy__sum">{formatGems(total)}</span>
              </span>
            ) : (
              // Без раунда цены места нет (в данных груза её нет), а «за 0» ввело бы в заблуждение.
              <span>{t('cargo.buy')}</span>
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
              {/* Телефон — карточка содержимого кейса 108×72 (skin-card--m); от 768 класс не действует. */}
              <SkinCard
                item={round.prize}
                chance={chance}
                href={`/${game}/items/${round.prize.id}`}
                className="cargo-prize__card skin-card--m"
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
