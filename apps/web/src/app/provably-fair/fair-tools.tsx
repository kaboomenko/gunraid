'use client';

import {
  contractMultiplier,
  hexToFloat,
  hmacSha256Hex,
  pickByTicket,
  rollToScaled,
  sha256Hex,
  ticketFromFloat,
  upgradeWins,
} from '@gunraid/game-core';
import type {
  CaseOpeningProofDto,
  ContractProofDto,
  FairSeedDto,
  PageDto,
  RevealedSeedDto,
  RotateSeedResultDto,
  UpgradeProofDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
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
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-dim">{t('serverSeedHash')}</div>
              <Mono>{seed.data.serverSeedHash}</Mono>
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-dim">{t('clientSeed')}</div>
                <Mono>{seed.data.clientSeed}</Mono>
              </div>
              <div>
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
          <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
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

type ProofKind = 'case_opening' | 'upgrade' | 'contract';
type AnyProof = CaseOpeningProofDto | UpgradeProofDto | ContractProofDto;
const KINDS: ProofKind[] = ['case_opening', 'upgrade', 'contract'];
const PARAM_TO_KIND: Record<string, ProofKind> = {
  opening: 'case_opening',
  upgrade: 'upgrade',
  contract: 'contract',
};

function Verifier() {
  const t = useTranslations('fair');
  const params = useSearchParams();
  const errorText = useErrorMessage();
  const initial = Object.entries(PARAM_TO_KIND).find(([param]) => params.get(param));
  const [kind, setKind] = useState<ProofKind>(initial?.[1] ?? 'case_opening');
  const [resultId, setResultId] = useState(initial ? (params.get(initial[0]) ?? '') : '');
  const [proof, setProof] = useState<AnyProof | null>(null);
  const [serverSeed, setServerSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [nonce, setNonce] = useState('0');
  const [run, setRun] = useState(0);

  const load = async (k: ProofKind, id: string) => {
    try {
      const p = await api.get<AnyProof>(`/fair/proof/${k}/${id}`);
      setProof(p);
      setServerSeed(p.serverSeed ?? '');
      setClientSeed(p.clientSeed);
      setNonce(String(p.nonce));
      setRun((x) => x + 1);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  useEffect(() => {
    if (initial && /^[0-9a-f-]{36}$/i.test(resultId)) void load(initial[1], resultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div>
        <h2 className="font-display text-lg font-bold uppercase">{t('verifyTitle')}</h2>
        <p className="text-sm text-muted">{t('verifyLead')}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('kind')}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setProof(null);
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
          if (/^[0-9a-f-]{36}$/i.test(resultId.trim())) void load(kind, resultId.trim());
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
      {proof && !proof.revealed && <p className="text-xs text-warning">{t('serverSeedHidden')}</p>}
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
            <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
              <div className="text-xs text-dim">{t('float')}</div>
              <Mono>{computed.float.toFixed(12)}</Mono>
            </div>
            {computed.kind === 'case_opening' && (
              <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
                <div className="text-xs text-dim">{t('ticket')}</div>
                <Mono>{computed.ticket}</Mono>
              </div>
            )}
            {computed.kind === 'upgrade' && proof?.type === 'upgrade' && (
              <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
                <div className="text-xs text-dim">
                  {t('upgradeRoll')} / {t('upgradeChance')}
                </div>
                <Mono>
                  {computed.roll} / {proof.chance}
                </Mono>
              </div>
            )}
            {computed.kind === 'contract' && (
              <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
                <div className="text-xs text-dim">{t('contractMultiplier')}</div>
                <Mono>
                  ×{computed.k.toFixed(6)} → {computed.target}
                </Mono>
              </div>
            )}
          </div>
          {computed.kind === 'case_opening' && computed.entry && (
            <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
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
    </Card>
  );
}

export function FairTools() {
  return (
    <div className="space-y-6">
      <SeedsPanel />
      <Verifier />
    </div>
  );
}
