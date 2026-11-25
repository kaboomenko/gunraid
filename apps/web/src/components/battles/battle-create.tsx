'use client';

import {
  BATTLE_FORMATS,
  BATTLE_FORMAT_SLOTS,
  BATTLE_MODES,
  type BattleCaseOptionDto,
  type BattleConfigDto,
  type BattleDto,
  type BattleFormatCode,
  type BattleModeCode,
} from '@gunraid/shared';
import { Flame, Minus, Plus, Swords, Trash2, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount, GemPill } from '@/components/ui/gem';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useInvalidateWallet } from '@/lib/queries';
import { useUi } from '@/lib/store';

/** Конструктор баттла: кейсы (с повторами), число игроков, режим. */
export function BattleCreate({
  game,
  cases,
  config,
}: {
  game: string;
  cases: BattleCaseOptionDto[];
  config: BattleConfigDto;
}) {
  const t = useTranslations('battles');
  const tc = useTranslations('battles.createPage');
  const me = useMe();
  const router = useRouter();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [format, setFormat] = useState<BattleFormatCode>('1v1');
  const [mode, setMode] = useState<BattleModeCode>('classic');
  const [busy, setBusy] = useState(false);

  const byId = new Map(cases.map((c) => [c.id, c]));
  const total = order.reduce((a, id) => a + (counts[id] ?? 0), 0);
  const cost = order.reduce((a, id) => a + (counts[id] ?? 0) * (byId.get(id)?.price ?? 0), 0);

  const add = (id: string) => {
    if (total >= config.maxCases) return toast.info(tc('limit', { max: config.maxCases }));
    setCounts((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    setOrder((o) => (o.includes(id) ? o : [...o, id]));
  };
  const remove = (id: string) => {
    const next = (counts[id] ?? 0) - 1;
    setCounts((c) => ({ ...c, [id]: Math.max(0, next) }));
    if (next <= 0) setOrder((o) => o.filter((x) => x !== id));
  };
  const clear = () => {
    setCounts({});
    setOrder([]);
  };

  const submit = async () => {
    if (!me.data) return openLogin();
    if (!total) return toast.info(tc('empty'));
    setBusy(true);
    try {
      const res = await api.post<BattleDto>(
        `/games/${game}/battles`,
        { cases: order.map((id) => ({ caseId: id, count: counts[id] ?? 0 })), format, mode },
        { idempotencyKey: newIdempotencyKey() },
      );
      invalidate();
      router.push(`/${game}/battles/${res.id}`);
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  const pill = (selected: boolean) =>
    cn(
      'clip-cut flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-xs font-bold uppercase transition [--cut:6px]',
      selected ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold uppercase">{tc('pickCases')}</h2>
          <p className="text-xs text-dim">{tc('pickHint')}</p>
        </div>
        {cases.length ? (
          <div className="grid grid-cols-2 gap-2.5 xs:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {cases.map((c) => {
              const n = counts[c.id] ?? 0;
              return (
                <div
                  key={c.id}
                  className={cn(
                    'cut flex flex-col items-center gap-2 p-3 text-center transition',
                    n > 0 && '[--cut-border:rgb(198_255_0/0.6)]',
                  )}
                  data-testid="battle-case-option"
                >
                  <button
                    type="button"
                    onClick={() => add(c.id)}
                    className="relative grid h-24 w-full place-items-center"
                    style={{
                      background: `radial-gradient(60% 70% at 50% 60%, ${c.accentColor}33, transparent 70%)`,
                    }}
                    aria-label={`${tc('add')}: ${c.name}`}
                  >
                    {c.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" className="h-20 w-20 object-contain" />
                    )}
                    {n > 0 && (
                      <span className="clip-cut absolute right-0 top-0 bg-accent px-1.5 text-xs font-bold text-accent-ink [--cut:4px]">
                        ×{n}
                      </span>
                    )}
                  </button>
                  <div className="w-full truncate text-sm font-semibold">{c.name}</div>
                  <GemAmount value={c.price} size="sm" className="text-accent" />
                  <div className="flex w-full gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      disabled={n === 0}
                      onClick={() => remove(c.id)}
                      aria-label={tc('remove')}
                    >
                      <Minus size={14} />
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => add(c.id)}
                      aria-label={tc('add')}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<Swords size={32} />} text={tc('empty')} />
        )}
      </section>

      <Card className="space-y-4 p-4 lg:sticky lg:top-[calc(var(--header-h)+var(--feed-h)+16px)]">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
            {tc('format')}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {BATTLE_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={pill(format === f)}
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                title={t(`formats.${f}`)}
              >
                <span className="flex">
                  {Array.from({ length: BATTLE_FORMAT_SLOTS[f] }, (_, i) => (
                    <User key={i} size={12} className={cn(f === '2v2' && i === 2 && 'ml-1')} />
                  ))}
                </span>
                {t(`formatsShort.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
            {tc('mode')}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {BATTLE_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={pill(mode === m)}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                <span className="flex items-center gap-1">
                  {m === 'crazy' && <Flame size={13} />}
                  {t(`modes.${m}`)}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-dim">{t(`modeHints.${mode}`)}</p>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">
              {tc('selected')} · {t('rounds', { count: total })}
            </span>
            {total > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-dim hover:text-text"
                onClick={clear}
              >
                <Trash2 size={12} /> {tc('clear')}
              </button>
            )}
          </div>
          {order.length ? (
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {order.map((id) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <li
                    key={id}
                    className="clip-cut flex items-center gap-2 bg-surface-2 px-2 py-1.5 [--cut:5px]"
                  >
                    {c.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" className="h-7 w-7 object-contain" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                    <span className="text-xs font-bold text-accent">×{counts[id]}</span>
                    <button
                      type="button"
                      className="text-dim hover:text-text"
                      onClick={() => remove(id)}
                      aria-label={tc('remove')}
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      type="button"
                      className="text-dim hover:text-text"
                      onClick={() => add(id)}
                      aria-label={tc('add')}
                    >
                      <Plus size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-dim">{tc('empty')}</p>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm text-muted">{tc('cost')}</span>
          <GemAmount value={cost} size="lg" className="text-accent" />
        </div>
        <Button
          size="lg"
          block
          loading={busy}
          disabled={!total}
          onClick={() => void submit()}
          data-testid="battle-create-submit"
        >
          {tc('submit')} <GemPill value={cost} />
        </Button>
        {config.allowBots && <p className="text-[11px] text-dim">{t('botsHint')}</p>}
      </Card>
    </div>
  );
}
