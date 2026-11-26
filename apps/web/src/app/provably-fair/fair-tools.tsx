'use client';

import {
  battleClientSeed,
  battleRoll,
  battleTiebreak,
  contractMultiplier,
  hexToFloat,
  hmacSha256Hex,
  pickByTicket,
  pickWeighted,
  resolveBattle,
  rollToScaled,
  sha256Hex,
  ticketFromFloat,
  upgradeWins,
} from '@gunraid/game-core';
import {
  formatGems,
  type BattleProofDto,
  type CargoProofDto,
  type CaseOpeningProofDto,
  type ContractProofDto,
  type FairSeedDto,
  type PageDto,
  type RevealedSeedDto,
  type RotateSeedResultDto,
  type UpgradeProofDto,
  type WheelProofDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatSeatRanges } from '@/lib/cargo-page';
import {
  CARGO_PROOF_HEAD,
  cargoPreimageHead,
  cargoProofRows,
  verifyCargoProof,
  type CargoProofCheckKey,
  type CargoProofOutcome,
} from '@/lib/cargo-proof';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="block break-all text-xs text-text">{children}</code>;
}

function SeedsPanel() {
  const t = useTranslations('fair');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const me = useMe();
  const seed = useQuery({
    queryKey: ['fair-seed'],
    queryFn: () => api.get<FairSeedDto>('/fair/seed'),
    enabled: Boolean(me.data),
  });
  const revealed = useQuery({
    queryKey: ['fair-revealed'],
    queryFn: () => api.get<PageDto<RevealedSeedDto>>('/fair/seeds'),
    enabled: Boolean(me.data),
  });
  const [clientSeed, setClientSeed] = useState('');
  const [busy, setBusy] = useState(false);

  const rotate = async (newSeed?: string) => {
    setBusy(true);
    try {
      const res = newSeed
        ? await api.put<RotateSeedResultDto>('/fair/client-seed', { clientSeed: newSeed })
        : await api.post<RotateSeedResultDto>('/fair/rotate');
      qc.setQueryData(['fair-seed'], res.current);
      await qc.invalidateQueries({ queryKey: ['fair-revealed'] });
      setClientSeed('');
      toast.success(t('rotated'));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!me.data) return <Card className="p-5 text-sm text-muted">{t('loginHint')}</Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h2 className="font-display text-lg font-bold uppercase">{t('yourSeeds')}</h2>
        {seed.data && (
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              <div className="text-xs text-dim">{t('serverSeedHash')}</div>
              <Mono>{seed.data.serverSeedHash}</Mono>
            </div>
            <div className="flex gap-6">
              <div className="space-y-2">
                <div className="text-xs text-dim">{t('clientSeed')}</div>
                <Mono>{seed.data.clientSeed}</Mono>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-dim">{t('nonce')}</div>
                <Mono>{seed.data.nonce}</Mono>
              </div>
            </div>
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (clientSeed.trim()) void rotate(clientSeed.trim());
          }}
        >
          <Input
            value={clientSeed}
            onChange={(e) => setClientSeed(e.target.value)}
            placeholder={t('newClientSeed')}
            aria-label={t('newClientSeed')}
            maxLength={64}
            className="h-10"
          />
          <Button type="submit" variant="secondary" loading={busy} disabled={!clientSeed.trim()}>
            {t('changeClientSeed')}
          </Button>
        </form>
        <Button variant="outline" block loading={busy} onClick={() => void rotate()}>
          <RefreshCw size={16} /> {t('rotate')}
        </Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg font-bold uppercase">{t('revealedTitle')}</h2>
        {revealed.data?.items.length ? (
          <ul
            className="max-h-80 space-y-3 overflow-y-auto pr-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            tabIndex={0}
            aria-label={t('revealedTitle')}
          >
            {revealed.data.items.map((r) => (
              <li key={r.id} className="clip-cut space-y-1 bg-surface-2 p-3 text-xs [--cut:6px]">
                <div className="flex justify-between text-dim">
                  <span>
                    {format.dateTime(new Date(r.revealedAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                  <span>{t('bets', { count: r.nonce })}</span>
                </div>
                <div className="text-dim">{t('serverSeed')}</div>
                <Mono>{r.serverSeed}</Mono>
                <div className="text-dim">{t('clientSeed')}</div>
                <Mono>{r.clientSeed}</Mono>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-dim">{t('revealedEmpty')}</p>
        )}
      </Card>
    </div>
  );
}

type ProofKind = 'case_opening' | 'upgrade' | 'contract' | 'battle' | 'wheel_spin' | 'cargo';
type SeedProof = CaseOpeningProofDto | UpgradeProofDto | ContractProofDto | WheelProofDto;
const KINDS: ProofKind[] = ['case_opening', 'upgrade', 'contract', 'battle', 'wheel_spin', 'cargo'];
const PARAM_TO_KIND: Record<string, ProofKind> = {
  opening: 'case_opening',
  upgrade: 'upgrade',
  contract: 'contract',
  battle: 'battle',
  wheel: 'wheel_spin',
  cargo: 'cargo',
};
const RESULT_ID_RE = /^[0-9a-f-]{36}$/i;

function Verifier() {
  const t = useTranslations('fair');
  const params = useSearchParams();
  const errorText = useErrorMessage();
  const me = useMe();
  const initial = Object.entries(PARAM_TO_KIND).find(([param]) => params.get(param));
  const [kind, setKind] = useState<ProofKind>(initial?.[1] ?? 'case_opening');
  const [resultId, setResultId] = useState(initial ? (params.get(initial[0]) ?? '') : '');
  const [proof, setProof] = useState<SeedProof | null>(null);
  const [battleProof, setBattleProof] = useState<BattleProofDto | null>(null);
  const [cargoProof, setCargoProof] = useState<CargoProofDto | null>(null);
  const [serverSeed, setServerSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [nonce, setNonce] = useState('0');
  const [run, setRun] = useState(0);
  /** Номер последнего запроса: ответ на более ранний (сменили вид, загрузили другой ID) не показывается. */
  const seq = useRef(0);
  /** Раунд груза, доказательство которого на экране или запрошено. */
  const cargoId = useRef(initial?.[1] === 'cargo' && RESULT_ID_RE.test(resultId) ? resultId : null);
  /** Кто смотрит: undefined — ещё неизвестно, null — гость. */
  const viewer = me.isPending ? undefined : (me.data?.id ?? null);

  const load = async (k: ProofKind, id: string) => {
    const n = ++seq.current;
    cargoId.current = k === 'cargo' ? id : null;
    try {
      const p = await api.get<SeedProof | BattleProofDto | CargoProofDto>(`/fair/proof/${k}/${id}`);
      if (n !== seq.current) return;
      if (p.type === 'cargo') {
        setCargoProof(p);
        setProof(null);
        setBattleProof(null);
        return;
      }
      if (p.type === 'battle') {
        setBattleProof(p);
        setProof(null);
        setCargoProof(null);
        return;
      }
      setBattleProof(null);
      setCargoProof(null);
      setProof(p);
      setServerSeed(p.serverSeed ?? '');
      setClientSeed(p.clientSeed);
      setNonce(String(p.nonce));
      setRun((x) => x + 1);
    } catch (err) {
      if (n === seq.current) toast.error(errorText(err));
    }
  };

  useEffect(() => {
    // Груз — в эффекте ниже, когда станет известно, кто смотрит.
    if (initial && initial[1] !== 'cargo' && RESULT_ID_RE.test(resultId))
      void load(initial[1], resultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Свои покупки в доказательстве груза сервер отмечает по сессии, поэтому запрос — из браузера (и лимит
    // запросов у каждого свой) и после /me: истёкший токен к этому времени уже обновлён. Вошли или вышли
    // на этой странице — доказательство перечитывается.
    if (viewer !== undefined && cargoId.current) void load('cargo', cargoId.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  const computed = useMemo(() => {
    if (!run || !serverSeed || !clientSeed || !/^\d+$/.test(nonce)) return null;
    const float = hexToFloat(hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:0`));
    const hashOk = proof ? sha256Hex(serverSeed) === proof.serverSeedHash : null;
    if (proof?.type === 'upgrade') {
      const roll = rollToScaled(float);
      const win = upgradeWins(roll, proof.chance);
      return {
        float,
        hashOk,
        kind: 'upgrade' as const,
        roll,
        win,
        match: roll === proof.roll && win === proof.isWin,
      };
    }
    if (proof?.type === 'wheel_spin') {
      const pick = pickWeighted(
        proof.prizes.map((x) => x.weight),
        float,
      );
      return {
        float,
        hashOk,
        kind: 'wheel_spin' as const,
        ticket: pick.ticket,
        total: proof.prizes.reduce((a, x) => a + x.weight, 0),
        label: proof.prizes[pick.index]?.label ?? '',
        match: pick.index === proof.prizeIndex && pick.ticket === proof.ticket,
      };
    }
    if (proof?.type === 'contract') {
      const k = contractMultiplier(
        float,
        { commission: 0, coefMin: proof.coefMin, coefMax: proof.coefMax },
        proof.gamma,
      );
      return {
        float,
        hashOk,
        kind: 'contract' as const,
        k,
        target: Math.round(proof.inputValue * k),
        match: Math.abs(k - proof.multiplier) < 1e-9,
      };
    }
    const ticket = ticketFromFloat(float);
    const entry = proof?.type === 'case_opening' ? pickByTicket(proof.contents, ticket) : null;
    return {
      float,
      hashOk,
      kind: 'case_opening' as const,
      ticket,
      entry,
      match: proof?.type === 'case_opening' ? entry?.itemId === proof.itemId : null,
    };
  }, [run, serverSeed, clientSeed, nonce, proof]);

  return (
    <Card className="space-y-4 p-5">
      {/* Межстрочный 100% с обрезкой по прописным: без отступа подзаголовок налезал на заголовок. */}
      <div className="space-y-2.5">
        <h2 className="font-display text-lg font-bold uppercase">{t('verifyTitle')}</h2>
        <p className="text-sm text-muted">{t('verifyLead')}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('kind')}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              seq.current++;
              cargoId.current = null;
              setKind(k);
              setProof(null);
              setBattleProof(null);
              setCargoProof(null);
            }}
            className={`clip-cut h-8 px-3 text-xs font-bold uppercase [--cut:5px] ${kind === k ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted'}`}
          >
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (RESULT_ID_RE.test(resultId.trim())) void load(kind, resultId.trim());
        }}
      >
        <Input
          value={resultId}
          onChange={(e) => setResultId(e.target.value)}
          placeholder={t('resultId')}
          aria-label={t('resultId')}
          className="h-10 font-mono text-xs"
        />
        <Button type="submit" variant="secondary">
          {t('load')}
        </Button>
      </form>
      {kind !== 'battle' && kind !== 'cargo' && (
        <>
          {proof && !proof.revealed && (
            <p className="text-xs text-warning">{t('serverSeedHidden')}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_120px]">
            <Field label={t('serverSeed')} htmlFor="v-server">
              <Input
                id="v-server"
                value={serverSeed}
                onChange={(e) => setServerSeed(e.target.value.trim())}
                className="h-10 font-mono text-xs"
              />
            </Field>
            <Field label={t('clientSeed')} htmlFor="v-client">
              <Input
                id="v-client"
                value={clientSeed}
                onChange={(e) => setClientSeed(e.target.value.trim())}
                className="h-10 font-mono text-xs"
              />
            </Field>
            <Field label="Nonce" htmlFor="v-nonce">
              <Input
                id="v-nonce"
                value={nonce}
                inputMode="numeric"
                onChange={(e) => setNonce(e.target.value.replace(/\D/g, ''))}
                className="h-10 font-mono text-xs"
              />
            </Field>
          </div>
          <Button onClick={() => setRun((x) => x + 1)} disabled={!serverSeed || !clientSeed}>
            {t('verify')}
          </Button>
          {computed && (
            <div className="space-y-2 text-sm">
              {computed.hashOk !== null && (
                <div
                  className={`flex items-center gap-2 ${computed.hashOk ? 'text-accent' : 'text-danger'}`}
                >
                  {computed.hashOk ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  {computed.hashOk ? t('hashOk') : t('hashBad')}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                  <div className="text-xs text-dim">{t('float')}</div>
                  <Mono>{computed.float.toFixed(12)}</Mono>
                </div>
                {computed.kind === 'case_opening' && (
                  <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                    <div className="text-xs text-dim">{t('ticket')}</div>
                    <Mono>{computed.ticket}</Mono>
                  </div>
                )}
                {computed.kind === 'upgrade' && proof?.type === 'upgrade' && (
                  <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                    <div className="text-xs text-dim">
                      {t('upgradeRoll')} / {t('upgradeChance')}
                    </div>
                    <Mono>
                      {computed.roll} / {proof.chance}
                    </Mono>
                  </div>
                )}
                {computed.kind === 'wheel_spin' && (
                  <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                    <div className="text-xs text-dim">
                      {t('wheelTicket', { total: computed.total })}
                    </div>
                    <Mono>
                      {computed.ticket} → {computed.label}
                    </Mono>
                  </div>
                )}
                {computed.kind === 'contract' && (
                  <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                    <div className="text-xs text-dim">{t('contractMultiplier')}</div>
                    <Mono>
                      ×{computed.k.toFixed(6)} → {computed.target}
                    </Mono>
                  </div>
                )}
              </div>
              {computed.kind === 'case_opening' && computed.entry && (
                <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                  <div className="text-xs text-dim">{t('item')}</div>
                  <div className="font-semibold">{computed.entry.name}</div>
                </div>
              )}
              {computed.kind === 'upgrade' && (
                <div className="text-xs text-muted">
                  {computed.win ? t('upgradeWin') : t('upgradeLose')}
                </div>
              )}
              {computed.match !== null && (
                <div
                  className={`flex items-center gap-2 text-xs ${computed.match ? 'text-accent' : 'text-danger'}`}
                >
                  {computed.match ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {computed.match ? t('match') : t('mismatch')}
                </div>
              )}
            </div>
          )}
          {proof?.type === 'case_opening' && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer text-dim">{t('contents')}</summary>
              <ul className="mt-2 space-y-1">
                {proof.contents.map((c) => (
                  <li key={c.itemId} className="flex justify-between gap-3">
                    <span className="truncate">{c.name}</span>
                    <span className="tabular text-dim">{(c.odds / 100000).toFixed(5)}%</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {kind === 'battle' && battleProof && <BattleProofView proof={battleProof} />}
      {kind === 'cargo' && cargoProof && (
        // Другой раунд или вошли на странице и появились свои покупки — вид заново (список раскрыт у своих).
        <CargoProofView
          key={`${cargoProof.id}:${cargoProof.purchases.some((p) => p.mine)}`}
          proof={cargoProof}
        />
      )}
    </Card>
  );
}

/** Проверка баттла: client seed из сидов участников, каждый раунд и победитель — в браузере. */
function BattleProofView({ proof }: { proof: BattleProofDto }) {
  const t = useTranslations('fair');
  const result = useMemo(() => {
    if (!proof.revealed || !proof.serverSeed || !proof.clientSeed) return null;
    const serverSeed = proof.serverSeed;
    const clientSeed = proof.clientSeed;
    const hashOk = sha256Hex(serverSeed) === proof.serverSeedHash;
    const clientOk = battleClientSeed(proof.slotSeeds) === clientSeed;
    const slots = proof.slotSeeds.length;
    const totals = Array.from({ length: slots }, () => 0);
    const rounds = proof.rounds.map((r) => ({
      round: r.round,
      caseName: r.caseName,
      rows: r.drops.map((d) => {
        const ticket = ticketFromFloat(battleRoll(serverSeed, clientSeed, r.round, d.slot));
        const entry = pickByTicket(r.contents, ticket);
        totals[d.slot] = (totals[d.slot] ?? 0) + d.value;
        return {
          slot: d.slot,
          ticket,
          name: entry.name,
          ok: entry.itemId === d.itemId && ticket === d.ticket,
        };
      }),
    }));
    const tiebreak = battleTiebreak(serverSeed, clientSeed);
    const res = resolveBattle(proof.format, proof.mode, totals, tiebreak);
    const winnerOk = res.winnerSlots.join(',') === (proof.winnerSlots ?? []).join(',');
    const allOk = rounds.every((r) => r.rows.every((x) => x.ok));
    return { hashOk, clientOk, rounds, res, winnerOk, allOk };
  }, [proof]);
  if (!result) return <p className="text-xs text-warning">{t('battleNotFinished')}</p>;
  const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <div className={`flex items-center gap-2 text-sm ${ok ? 'text-accent' : 'text-danger'}`}>
      {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      {children}
    </div>
  );
  return (
    <div className="space-y-3" data-testid="battle-proof">
      <Check ok={result.hashOk}>{result.hashOk ? t('hashOk') : t('hashBad')}</Check>
      <Check ok={result.clientOk}>{t('battleClientSeed')}</Check>
      <Check ok={result.allOk}>{result.allOk ? t('match') : t('mismatch')}</Check>
      <Check ok={result.winnerOk}>
        {t('battleWinner', { slots: result.res.winnerSlots.map((s) => s + 1).join(', ') })}
      </Check>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-dim">{t('battleSlotSeeds')}</summary>
        <ol className="mt-2 space-y-1 font-mono">
          {proof.slotSeeds.map((seed, i) => (
            <li key={i} className="break-all">
              {i + 1}. {seed}
            </li>
          ))}
        </ol>
      </details>
      <div className="space-y-2">
        {result.rounds.map((r) => (
          <div key={r.round} className="clip-cut bg-surface-2 p-3 text-xs [--cut:6px]">
            <div className="mb-1 font-semibold text-text">
              {t('battleRound', { n: r.round + 1 })} · {r.caseName}
            </div>
            <ul className="space-y-0.5">
              {r.rows.map((x) => (
                <li key={x.slot} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    #{x.slot + 1} · {x.name}
                  </span>
                  <span className={`tabular ${x.ok ? 'text-dim' : 'text-danger'}`}>{x.ticket}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Формула места в грузе (D4) — та же, что в how5 и docs, строкой кода. */
const CARGO_FORMULA =
  'clientSeed = SHA256(JSON.stringify([[from, to, "seed"], …]))\nhmac = HMAC_SHA256(serverSeed, `${clientSeed}:0:0`)\nfloat = parseInt(hmac.slice(0, 13), 16) / 2^52\nseat = floor(float × sold) + 1';

const CARGO_CHECK_TEST_ID: Record<CargoProofCheckKey, string> = {
  hash: 'cargo-proof-hash',
  seats: 'cargo-proof-seats',
  client: 'cargo-proof-client',
  seat: 'cargo-proof-seat',
  void: 'cargo-proof-void',
};

function ProofCheck({
  ok,
  testId,
  children,
}: {
  ok: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('fair');
  return (
    <div
      className={cn('flex items-center gap-2 text-sm', ok ? 'text-accent' : 'text-danger')}
      data-testid={testId}
      data-ok={ok}
    >
      {ok ? (
        <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
      ) : (
        <XCircle size={16} className="shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0">
        {/* Итог проверки виден по значку и цвету; скринридеру — словами. */}
        <span className="sr-only">{t(ok ? 'checkPassed' : 'checkFailed')}: </span>
        {children}
      </span>
    </div>
  );
}

/** Значение доказательства (сид, хэш, число) с подписью — моноширинным, переносится по символам. */
function ProofValue({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
      <div className="text-xs text-dim">{label}</div>
      <code className="block break-all text-xs text-text" data-testid={testId}>
        {children}
      </code>
    </div>
  );
}

/**
 * Проверка раунда груза (§A.4): хэш server seed, места подряд, client seed раунда из покупок и место —
 * в браузере кодом game-core (D4). Пока раунд идёт — commit и покупки: покупатель сверяет свои места и
 * seed до приземления (D5). У отменённого и закрытого по минимуму — место, которое выиграло бы (D33).
 */
function CargoProofView({ proof }: { proof: CargoProofDto }) {
  const t = useTranslations('fair');
  const tc = useTranslations('cargo');
  const v = useMemo(() => verifyCargoProof(proof), [proof]);
  const purchases = proof.purchases;
  const mine = useMemo(() => purchases.filter((p) => p.mine), [purchases]);
  const mineIndexes = useMemo(() => purchases.flatMap((p, i) => (p.mine ? [i] : [])), [purchases]);
  const [showAll, setShowAll] = useState(false);
  const [showingAll, startShowAll] = useTransition();
  const rows = useMemo(
    () =>
      cargoProofRows(
        purchases.length,
        { mine: mineIndexes, pinned: v.seatOwner === null ? [] : [v.seatOwner] },
        showAll,
      ),
    [purchases.length, mineIndexes, v.seatOwner, showAll],
  );
  const preimage = useMemo(() => cargoPreimageHead(purchases), [purchases]);
  // Список сразу раскрыт, пока раунд идёт (смотреть больше нечего) и когда в нём есть свои покупки.
  const [listOpen, setListOpen] = useState(proof.status === 'open' || mine.length > 0);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    // Свои покупки могут быть далеко в списке — он прокручивается к первой (страница остаётся на месте;
    // список — relative, поэтому offsetTop строки отсчитывается от него).
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-mine]');
    if (!listOpen || !list || !row || list.scrollHeight <= list.clientHeight) return;
    list.scrollTop = row.offsetTop - 4;
  }, [listOpen]);

  const sold = formatGems(v.sold ?? proof.seatsSold);
  const landed = v.outcome === 'landed';
  const ranges = mine.length > 0 ? formatSeatRanges(mine) : null;
  const status: Record<CargoProofOutcome, () => string | null> = {
    open: () => t('cargoNotLanded'),
    landed: () => null,
    noSales: () => t('cargoNoSales'),
    minSeats: () => t('cargoMinSeats', { min: formatGems(proof.minSeatsToLand ?? 0) }),
    cancelled: () => t('cargoCancelled'),
    cancelledEmpty: () => t('cargoCancelledEmpty'),
  };
  const statusText = status[v.outcome]();
  const seatsText = (p: { seatFrom: number; seatTo: number }) =>
    p.seatFrom === p.seatTo
      ? t('cargoSeat', { seat: p.seatFrom })
      : t('cargoPurchase', { from: p.seatFrom, to: p.seatTo });
  const mineText = t('cargoMine');
  const recordedSeat = landed ? proof.winningSeat : proof.voidSeat;
  const mark =
    v.seat === null
      ? null
      : landed
        ? { kind: 'winner' as const, text: t('cargoWinnerMark', { seat: v.seat }) }
        : { kind: 'void' as const, text: t('cargoVoidMark', { seat: v.seat }) };

  return (
    <div className="space-y-4" data-testid="cargo-proof" data-outcome={v.outcome}>
      <div className="space-y-2.5">
        <div className="font-display text-base font-bold uppercase" data-testid="cargo-proof-title">
          {t('cargoRound', { name: proof.cargoName, number: proof.number })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 text-xs text-muted">
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {t('cargoPrize', { name: proof.prize.name })}
            </span>
            <GemAmount value={proof.prize.price} size="xs" />
          </span>
          <span>
            {t('cargoSold', {
              sold: formatGems(proof.seatsSold),
              total: formatGems(proof.seatsTotal),
            })}
          </span>
        </div>
      </div>

      {statusText && (
        <p
          className={cn('text-sm', v.outcome === 'open' ? 'text-warning' : 'text-text')}
          data-testid="cargo-proof-status"
        >
          {statusText}
        </p>
      )}

      {v.checks.length > 0 && (
        <div className="space-y-2.5">
          {v.checks.map((c) => (
            <ProofCheck key={c.key} ok={c.ok} testId={CARGO_CHECK_TEST_ID[c.key]}>
              {c.key === 'hash'
                ? t(c.ok ? 'hashOk' : 'hashBad')
                : c.key === 'seats'
                  ? t('cargoSeats', { sold })
                  : c.key === 'client'
                    ? t('cargoClientSeed')
                    : t(c.key === 'seat' ? 'cargoWinningSeat' : 'cargoVoidSeat', {
                        seat: v.seat ?? '—',
                        sold,
                      })}
              {/* Пересчёт разошёлся с сайтом — видно, какое место записано. */}
              {(c.key === 'seat' || c.key === 'void') && !c.ok && recordedSeat !== null && (
                <> — {t('cargoRecordedSeat', { seat: recordedSeat })}</>
              )}
            </ProofCheck>
          ))}
        </div>
      )}

      {landed && proof.winner && (
        <p
          className="text-sm font-semibold text-text [overflow-wrap:anywhere]"
          data-testid="cargo-proof-winner"
        >
          {t('cargoWinner', { nickname: proof.winner.nickname })}
        </p>
      )}

      <div className="grid gap-2">
        {proof.serverSeed && (
          <ProofValue label={t('serverSeed')} testId="cargo-proof-server-seed">
            {proof.serverSeed}
          </ProofValue>
        )}
        <ProofValue label={t('serverSeedHash')} testId="cargo-proof-commit">
          {proof.serverSeedHash}
        </ProofValue>
        {v.clientSeed !== null && (
          <ProofValue label={t('cargoRoundClientSeed')} testId="cargo-proof-client-seed">
            {proof.clientSeed ?? '—'}
          </ProofValue>
        )}
        {v.float !== null && v.seat !== null && (
          <div className="grid grid-cols-2 gap-2">
            <ProofValue label={t('float')}>{v.float.toFixed(12)}</ProofValue>
            <ProofValue label={t('cargoSeatCell')} testId="cargo-proof-seat-value">
              {t('cargoSeat', { seat: v.seat })}
            </ProofValue>
          </div>
        )}
      </div>

      {ranges && (
        <p className="text-sm text-accent" data-testid="cargo-proof-mine">
          {tc('mySeats', {
            count: mine.reduce((s, p) => s + p.seatTo - p.seatFrom + 1, 0),
            ranges: ranges.text,
            more: ranges.more,
          })}
        </p>
      )}

      {purchases.length > 0 && (
        <>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-dim">{t('formula')}</div>
            <pre className="clip-cut overflow-x-auto bg-surface-2 p-3 text-xs text-accent [--cut:6px]">
              {CARGO_FORMULA}
            </pre>
          </div>
          <details
            className="text-xs text-muted"
            open={listOpen}
            onToggle={(e) => setListOpen(e.currentTarget.open)}
            data-testid="cargo-proof-purchases"
          >
            <summary className="cursor-pointer text-dim">{t('cargoPurchases')}</summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                <div className="text-dim">{t('cargoPreimage')}</div>
                <code className="block break-all text-text" data-testid="cargo-proof-preimage">
                  {preimage}
                </code>
              </div>
              {/* Рамка фокуса — внутри: срез углов (clip-path) обрезал бы её снаружи. */}
              <ol
                ref={listRef}
                className="clip-cut relative max-h-[28rem] space-y-0.5 overflow-y-auto bg-surface-2 p-1 [--cut:6px] focus-visible:outline-offset-[-2px]"
                tabIndex={0}
                aria-label={t('cargoPurchases')}
                data-testid="cargo-proof-list"
              >
                {rows.map((row, i) =>
                  row.kind === 'gap' ? (
                    <li
                      key={`gap-${i}`}
                      className="px-3 py-2 text-dim"
                      data-testid="cargo-proof-gap"
                    >
                      {t('cargoSkipped', { count: row.count, n: formatGems(row.count) })}
                    </li>
                  ) : (
                    <CargoPurchaseRow
                      key={row.index}
                      purchase={purchases[row.index]!}
                      seats={seatsText(purchases[row.index]!)}
                      mark={row.index === v.seatOwner ? mark : null}
                      mine={mineText}
                      lazy={showAll}
                    />
                  ),
                )}
              </ol>
              {!showAll && purchases.length > CARGO_PROOF_HEAD && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={showingAll}
                  onClick={() => {
                    // До 10 000 строк (D38) — переходом: React строит список частями, страница не замирает.
                    startShowAll(() => setShowAll(true));
                    // Кнопка исчезнет — фокус переходит в список, его можно листать с клавиатуры.
                    listRef.current?.focus({ preventScroll: true });
                  }}
                  data-testid="cargo-proof-show-all"
                >
                  {t('cargoShowAll', { count: formatGems(purchases.length) })}
                </Button>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

/**
 * Строка покупки: места, client seed покупателя; свои, место победителя и «выиграло бы» — с метками.
 * `lazy` — весь список (до 10 000 строк, D38): строки вне окна списка браузер не раскладывает и не рисует,
 * высота-заглушка — как у строки (24 px, на телефоне seed идёт второй строкой — 40 px).
 */
function CargoPurchaseRow({
  purchase: p,
  seats,
  mark,
  mine,
  lazy,
}: {
  purchase: CargoProofDto['purchases'][number];
  /** Тексты — готовыми строками от родителя: без хука перевода в каждой из 10 000 строк. */
  seats: string;
  mark: { kind: 'winner' | 'void'; text: string } | null;
  mine: string;
  lazy: boolean;
}) {
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2',
        lazy &&
          '[contain-intrinsic-size:auto_2.5rem] [content-visibility:auto] sm:[contain-intrinsic-size:auto_1.5rem]',
        p.mine ? 'bg-accent-soft text-text' : mark && 'bg-surface-3',
      )}
      data-testid="cargo-proof-row"
      data-mine={p.mine || undefined}
      data-mark={mark?.kind}
    >
      <span className="tabular w-24 shrink-0 font-semibold text-text">{seats}</span>
      {/* На телефоне seed — своей строкой под местами и метками, чтобы не рвался посередине. */}
      <code className="order-last min-w-0 basis-full break-all sm:order-none sm:flex-1">
        {p.clientSeed}
      </code>
      {(mark || p.mine) && (
        <span className="flex flex-wrap gap-1.5">
          {mark && <Badge tone={mark.kind === 'winner' ? 'accent' : 'warning'}>{mark.text}</Badge>}
          {p.mine && <Badge tone="soft">{mine}</Badge>}
        </span>
      )}
    </li>
  );
}

export function FairTools() {
  const params = useSearchParams();
  return (
    <div className="space-y-6">
      <SeedsPanel />
      {/*
       * Другой адрес (ссылка «Проверить» на другой раунд, «назад») — проверка заново,
       * а не прежний результат.
       */}
      <Verifier key={params.toString()} />
    </div>
  );
}
