'use client';

import {
  BATTLE_ROUND_PAUSE_MS,
  WS_EVENTS,
  type BattleDropDto,
  type BattleDto,
  type BattlePlayerDto,
  type BattleRoundEventDto,
  type CaseContentItemDto,
  type CaseDetailDto,
} from '@gunraid/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Crown,
  Link2,
  RotateCcw,
  ShieldCheck,
  Trophy,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { GemAmount, GemPill } from '@/components/ui/gem';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useInvalidateWallet } from '@/lib/queries';
import { noteServerTime, serverNow, useRoom, useSocketEvent } from '@/lib/socket';
import { sound } from '@/lib/sound';
import { useUi } from '@/lib/store';
import { FormatBadge, ModeBadge, PlayerAvatar, playerName } from './battle-parts';
import { BattleReel } from './battle-reel';

type Phase = 'lobby' | 'cancelled' | 'countdown' | 'rounds' | 'settling' | 'done';

const RANK: Record<BattleDto['status'], number> = {
  waiting: 0,
  in_progress: 1,
  finished: 2,
  cancelled: 2,
};

function mergeDrops(a: BattleDropDto[], b: BattleDropDto[]): BattleDropDto[] {
  const map = new Map(a.map((d) => [`${d.round}:${d.slot}`, d]));
  for (const d of b) map.set(`${d.round}:${d.slot}`, d);
  return [...map.values()].sort((x, y) => x.round - y.round || x.slot - y.slot);
}

/** Состояние с сервера не должно откатывать уже известное (порядок событий не гарантирован). */
function mergeState(prev: BattleDto, next: BattleDto): BattleDto {
  if (next.id !== prev.id) return prev;
  const base = RANK[next.status] >= RANK[prev.status] ? next : prev;
  return {
    ...base,
    drops: mergeDrops(prev.drops, next.drops),
    revealedRounds: Math.max(prev.revealedRounds, next.revealedRounds),
  };
}

function useServerClock(initial: number, intervalMs: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Комната баттла: лобби, синхронные раунды по серверному времени, итог и повтор. */
export function BattleRoom({ initial }: { initial: BattleDto }) {
  const t = useTranslations('battles');
  const tItems = useTranslations('items');
  const me = useMe();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const [battle, setBattle] = useState<BattleDto>(initial);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => noteServerTime(initial.serverTime), [initial.serverTime]);

  const refetch = useCallback(async () => {
    try {
      const fresh = await api.get<BattleDto>(`/battles/${initial.id}`);
      setBattle((prev) => mergeState(prev, fresh));
    } catch {
      // сеть восстановится — следующее событие или повтор обновят состояние
    }
  }, [initial.id]);

  useRoom(`battle:${initial.id}`);
  useSocketEvent<BattleDto>(WS_EVENTS.battleState, (s) => setBattle((prev) => mergeState(prev, s)));
  useSocketEvent<BattleDto>(WS_EVENTS.battleFinished, (s) =>
    setBattle((prev) => mergeState(prev, s)),
  );
  useSocketEvent<BattleRoundEventDto>(WS_EVENTS.battleRound, (e) => {
    if (e.battleId !== initial.id) return;
    setBattle((prev) => ({
      ...prev,
      drops: mergeDrops(prev.drops, e.drops),
      revealedRounds: Math.max(prev.revealedRounds, e.round + 1),
    }));
  });
  useSocketEvent('connect', () => void refetch());

  const live = battle.status === 'in_progress' || replayAt !== null;
  const now = useServerClock(Date.parse(initial.serverTime), live ? 100 : 1000);

  // ---------- Таймлайн ----------
  const roundMs = battle.roundDurationMs;
  const spinMs = Math.max(1000, roundMs - BATTLE_ROUND_PAUSE_MS);
  const base = replayAt ?? (battle.startsAt ? Date.parse(battle.startsAt) : null);
  const endAt = base !== null ? base + battle.roundsCount * roundMs : null;
  let phase: Phase;
  if (battle.status === 'cancelled') phase = 'cancelled';
  else if (battle.status === 'waiting' || base === null || endAt === null) phase = 'lobby';
  else if (now < base) phase = 'countdown';
  else if (now < endAt) phase = 'rounds';
  else phase = battle.status === 'finished' ? 'done' : 'settling';

  const cr =
    phase === 'rounds'
      ? Math.min(battle.roundsCount - 1, Math.floor((now - base!) / roundMs))
      : phase === 'countdown' || phase === 'lobby'
        ? 0
        : battle.roundsCount - 1;
  const spinStart = base !== null ? base + cr * roundMs : 0;
  const spinning = phase === 'rounds' && now - spinStart < spinMs;
  const isVisible = (d: BattleDropDto) =>
    phase === 'done' || phase === 'settling'
      ? true
      : phase === 'rounds'
        ? d.round < cr || (d.round === cr && !spinning)
        : false;
  const visibleDrops = battle.drops.filter(isVisible);
  const totals = Array.from({ length: battle.maxPlayers }, (_, slot) =>
    visibleDrops.filter((d) => d.slot === slot).reduce((a, d) => a + d.value, 0),
  );
  const pot = totals.reduce((a, v) => a + v, 0);

  // Пропущено событие раунда (переподключение) — догружаем состояние.
  const missing =
    phase === 'rounds' && !battle.drops.some((d) => d.round === cr) && now > spinStart + 300;
  const askedFor = useRef(-1);
  useEffect(() => {
    if (missing && askedFor.current !== cr && replayAt === null) {
      askedFor.current = cr;
      void refetch();
    }
  }, [missing, cr, refetch, replayAt]);
  useEffect(() => {
    if (phase === 'settling') {
      const id = setTimeout(() => void refetch(), 2500);
      return () => clearTimeout(id);
    }
  }, [phase, refetch]);

  const meId = me.data?.id ?? null;
  const mySlot = battle.players.findIndex((p) => p?.user?.id === meId);
  const isCreator = meId !== null && battle.creatorId === meId;
  const winnerSlots = phase === 'done' ? (battle.winnerSlots ?? []) : [];
  const iWon = mySlot >= 0 && winnerSlots.includes(mySlot);

  // Звук итога — только если досмотрели баттл.
  const prevPhase = useRef<Phase>(phase);
  useEffect(() => {
    if (prevPhase.current !== 'done' && phase === 'done' && prevPhase.current !== 'lobby') {
      if (mySlot >= 0) {
        if (iWon) sound.win(2);
        else sound.lose();
      } else sound.win(0);
    }
    prevPhase.current = phase;
  }, [phase, mySlot, iWon]);

  // Содержимое кейса текущего раунда — для ленты рулетки.
  const roundCase = battle.rounds[cr];
  const nextCase = battle.rounds[cr + 1];
  const pool = useQuery({
    queryKey: ['case-items', battle.game, roundCase?.slug],
    enabled: Boolean(roundCase),
    staleTime: 300_000,
    queryFn: () =>
      api.get<CaseDetailDto>(`/games/${battle.game}/cases/${roundCase!.slug}`).then((c) => c.items),
  });
  useQuery({
    queryKey: ['case-items', battle.game, nextCase?.slug],
    enabled: Boolean(nextCase) && phase === 'rounds',
    staleTime: 300_000,
    queryFn: () =>
      api.get<CaseDetailDto>(`/games/${battle.game}/cases/${nextCase!.slug}`).then((c) => c.items),
  });

  // ---------- Действия ----------
  const join = async (slot: number) => {
    if (!me.data) return openLogin();
    setBusy(`join-${slot}`);
    try {
      const res = await api.post<BattleDto>(
        `/battles/${battle.id}/join`,
        { slot },
        { idempotencyKey: newIdempotencyKey() },
      );
      setBattle((prev) => mergeState(prev, res));
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const addBots = async () => {
    setBusy('bots');
    try {
      const res = await api.post<BattleDto>(`/battles/${battle.id}/bots`, {
        clientSeed: randomSeed(),
      });
      setBattle((prev) => mergeState(prev, res));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!confirmCancel) return setConfirmCancel(true);
    setBusy('cancel');
    try {
      const res = await api.post<BattleDto>(`/battles/${battle.id}/cancel`);
      setBattle((prev) => mergeState(prev, res));
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t('copied'));
    } catch {
      // буфер обмена недоступен — ничего страшного
    }
  };

  // ---------- Колонки ----------
  const compact = battle.maxPlayers >= 3;
  const column = (slot: number) => {
    const p = battle.players[slot] ?? null;
    const drop = battle.drops.find((d) => d.round === cr && d.slot === slot) ?? null;
    const mine = visibleDrops.filter((d) => d.slot === slot).reverse();
    const won = winnerSlots.includes(slot);
    const lostCol = phase === 'done' && !won;
    return (
      <SlotColumn
        key={slot}
        slot={slot}
        player={p}
        isMe={slot === mySlot}
        total={totals[slot] ?? 0}
        won={won}
        lost={lostCol}
        payout={phase === 'done' ? (p?.payout ?? 0) : null}
        canJoin={phase === 'lobby' && battle.status === 'waiting' && !p && mySlot < 0}
        joining={busy === `join-${slot}`}
        entryPrice={battle.entryPrice}
        onJoin={() => void join(slot)}
        reel={
          phase === 'lobby' || phase === 'cancelled' ? null : (
            <BattleReel
              pool={(pool.data ?? []) as CaseContentItemDto[]}
              winner={phase === 'countdown' ? null : (drop?.item ?? null)}
              startAt={spinStart}
              durationMs={spinMs}
              spinKey={`${battle.id}:${replayAt ?? 0}:${cr}:${slot}`}
              idleImage={roundCase?.imageUrl}
              compact={compact}
              ticks={slot === 0 && phase === 'rounds'}
              highlight={lostCol ? false : undefined}
            />
          )
        }
        drops={mine}
        stLabel={tItems('stattrakBadge')}
        svLabel={tItems('souvenirBadge')}
        lostLabel={t('lost')}
        compact={compact}
      />
    );
  };

  const winners = (battle.winnerSlots ?? [])
    .map((s) => battle.players[s])
    .filter((p): p is BattlePlayerDto => Boolean(p));

  return (
    <div className="space-y-4">
      <Link
        href={`/${battle.game}/battles`}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} /> {t('back')}
      </Link>

      {/* Шапка */}
      <section className="cut flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FormatBadge format={battle.format} />
          <ModeBadge mode={battle.mode} />
          <span className="text-xs font-semibold uppercase tracking-wider text-dim">
            {phase === 'rounds'
              ? t('round', { current: cr + 1, total: battle.roundsCount })
              : phase === 'countdown'
                ? t('startsIn')
                : phase === 'settling'
                  ? t('settling')
                  : t(`status.${battle.status}`)}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-dim">{t('entry')}</div>
            <GemAmount value={battle.entryPrice} size="sm" />
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-dim">{t('totalPot')}</div>
            <GemAmount value={pot} size="sm" className="text-accent" />
          </div>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => void share()}
            aria-label={t('share')}
          >
            <Link2 size={16} />
          </Button>
        </div>
      </section>

      {/* Кейсы по раундам */}
      <div
        className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        data-testid="battle-rounds"
      >
        {battle.rounds.map((r) => {
          const done =
            phase === 'done' || phase === 'settling' || (phase === 'rounds' && r.round < cr);
          const current = (phase === 'rounds' || phase === 'countdown') && r.round === cr;
          return (
            <div
              key={r.round}
              className={cn(
                'clip-cut relative grid h-16 w-16 shrink-0 place-items-center bg-surface-2 transition [--cut:6px]',
                current && 'bg-accent-soft ring-2 ring-accent ring-inset',
                done && 'opacity-40',
              )}
              title={r.name}
            >
              {r.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt={r.name} className="h-12 w-12 object-contain" />
              )}
              <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-dim">
                {r.round + 1}
              </span>
            </div>
          );
        })}
      </div>

      {/* Баннеры состояния */}
      {phase === 'cancelled' && (
        <div className="cut flex items-center gap-3 p-4 text-sm [--cut-border:rgb(255_61_94/0.5)]">
          <XCircle className="shrink-0 text-danger" />
          {battle.cancelReason === 'timeout' ? t('cancelledTimeout') : t('cancelledCreator')}
        </div>
      )}
      {phase === 'done' && (
        <div
          className={cn(
            'cut flex flex-wrap items-center justify-between gap-3 p-4',
            mySlot >= 0 && winnerSlots.includes(mySlot)
              ? '[--cut-border:rgb(198_255_0/0.7)] [--cut-bg:#1b2110]'
              : '',
          )}
          data-testid="battle-result"
        >
          <div className="flex items-center gap-3">
            <Trophy className="text-accent" />
            {mySlot >= 0 ? (
              winnerSlots.includes(mySlot) ? (
                <span className="font-display text-xl font-bold uppercase">
                  {t('youWon')}{' '}
                  <GemAmount
                    value={battle.players[mySlot]?.payout ?? 0}
                    size="lg"
                    className="text-accent"
                  />
                </span>
              ) : (
                <span className="font-display text-xl font-bold uppercase">{t('youLost')}</span>
              )
            ) : (
              <span className="font-display text-lg font-bold uppercase">
                {winners.length > 1 ? t('winners') : t('winner')}:{' '}
                {winners.map((p) => playerName(p)).join(', ')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReplayAt(serverNow() + 1200)}>
              <RotateCcw size={14} /> {t('replay')}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/provably-fair?battle=${battle.id}`}>
                <ShieldCheck size={14} /> {t('fair')}
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* Участники */}
      <div className="relative">
        {battle.format === '2v2' ? (
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
            <TeamBlock label={t('team', { n: 1 })}>{[0, 1].map(column)}</TeamBlock>
            <div className="grid place-items-center font-display text-2xl font-extrabold text-dim md:pt-24">
              {t('vs')}
            </div>
            <TeamBlock label={t('team', { n: 2 })}>{[2, 3].map(column)}</TeamBlock>
          </div>
        ) : (
          <div
            className={cn(
              'grid gap-2 sm:gap-3',
              battle.maxPlayers === 2 && 'grid-cols-2',
              battle.maxPlayers === 3 && 'grid-cols-3',
              battle.maxPlayers === 4 && 'grid-cols-2 md:grid-cols-4',
            )}
          >
            {Array.from({ length: battle.maxPlayers }, (_, i) => column(i))}
          </div>
        )}
        {phase === 'countdown' && base !== null && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span
              key={Math.ceil((base - now) / 1000)}
              className="font-display text-8xl font-extrabold text-accent drop-shadow-[0_0_24px_rgba(198,255,0,0.6)]"
            >
              {Math.max(1, Math.ceil((base - now) / 1000))}
            </span>
          </div>
        )}
        {phase === 'settling' && (
          <div className="pointer-events-none absolute inset-x-0 top-24 grid place-items-center">
            <span className="clip-cut flex items-center gap-2 bg-surface-3 px-4 py-2 text-sm font-semibold">
              <Spinner /> {t('settling')}
            </span>
          </div>
        )}
      </div>

      {/* Лобби: действия */}
      {phase === 'lobby' && battle.status === 'waiting' && (
        <section className="cut flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm text-muted">
            {t('expiresIn')}{' '}
            <Countdown to={battle.expiresAt} className="font-semibold text-text tabular" />
          </div>
          <div className="flex flex-wrap gap-2">
            {isCreator && (
              <>
                <Button
                  loading={busy === 'bots'}
                  onClick={() => void addBots()}
                  data-testid="battle-bots"
                >
                  <Bot size={16} /> {t('addBots')}
                </Button>
                <Button
                  variant={confirmCancel ? 'danger' : 'ghost'}
                  loading={busy === 'cancel'}
                  onClick={() => void cancel()}
                  onBlur={() => setConfirmCancel(false)}
                  data-testid="battle-cancel"
                >
                  {confirmCancel ? t('cancelSure') : t('cancel')}
                </Button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function TeamBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-wider text-dim">{label}</div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">{children}</div>
    </div>
  );
}

function SlotColumn({
  slot,
  player,
  isMe,
  total,
  won,
  lost,
  payout,
  canJoin,
  joining,
  entryPrice,
  onJoin,
  reel,
  drops,
  stLabel,
  svLabel,
  lostLabel,
  compact,
}: {
  slot: number;
  player: BattlePlayerDto | null;
  isMe: boolean;
  total: number;
  won: boolean;
  lost: boolean;
  payout: number | null;
  canJoin: boolean;
  joining: boolean;
  entryPrice: number;
  onJoin: () => void;
  reel: React.ReactNode;
  drops: BattleDropDto[];
  stLabel: string;
  svLabel: string;
  lostLabel: string;
  compact: boolean;
}) {
  const t = useTranslations('battles');
  return (
    <div
      className={cn(
        'cut flex min-w-0 flex-col transition',
        won && '[--cut-border:rgb(198_255_0/0.85)] [--cut-bg:#1b2110]',
        lost && 'opacity-60',
        isMe && !won && '[--cut-border:var(--color-line-strong)]',
      )}
      data-testid={`battle-slot-${slot}`}
    >
      <div className="flex items-center gap-2 p-2.5 sm:p-3">
        <PlayerAvatar player={player} size={compact ? 'sm' : 'md'} highlight={won} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {player ? (
              <span className="truncate">{player.user?.nickname ?? player.bot?.nickname}</span>
            ) : (
              <span className="text-dim">{t('freeSlot')}</span>
            )}
            {player?.bot && (
              <span className="clip-cut bg-info/15 px-1 text-[9px] font-bold uppercase text-info [--cut:3px]">
                {t('bot')}
              </span>
            )}
            {isMe && (
              <span className="clip-cut bg-accent-soft px-1 text-[9px] font-bold uppercase text-accent [--cut:3px]">
                {t('you')}
              </span>
            )}
          </div>
          <GemAmount value={total} size="sm" className={won ? 'text-accent' : 'text-muted'} />
        </div>
        {won && <Crown size={18} className="shrink-0 text-accent" />}
      </div>
      {reel ?? (
        <div
          className={cn(
            'grid place-items-center border-y border-line bg-surface-2/40 p-3 text-center',
            compact ? 'h-[150px] md:h-[190px]' : 'h-[180px] md:h-[230px]',
          )}
        >
          {player ? (
            <span className="text-xs text-dim">{t('waitingPlayers')}</span>
          ) : canJoin ? (
            <Button
              size="sm"
              loading={joining}
              onClick={onJoin}
              data-testid={`battle-join-${slot}`}
            >
              <UserPlus size={14} /> {t('joinFor')} <GemPill value={entryPrice} size="xs" />
            </Button>
          ) : (
            <span className="text-xs text-dim">{t('waitingPlayer')}</span>
          )}
        </div>
      )}
      {payout !== null && won && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
          <span className="text-dim">{t('payout')}</span>
          <GemAmount value={payout} size="sm" className="text-accent" />
        </div>
      )}
      {drops.length > 0 && (
        <div
          className={cn(
            'grid gap-1.5 p-2',
            compact ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2',
          )}
        >
          {drops.map((d) => (
            <ItemTile
              key={`${d.round}:${d.slot}`}
              item={d.item}
              size="sm"
              stLabel={stLabel}
              svLabel={svLabel}
              dimmed={lost}
              footer={
                lost ? (
                  <span className="mt-0.5 text-[10px] font-bold uppercase text-danger">
                    {lostLabel}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
