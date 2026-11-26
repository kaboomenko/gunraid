'use client';

import {
  CARGO_IMAGE_KINDS,
  CARGO_ROUND_STATUSES,
  cargoImageUrl,
  cargoImageVariant,
  type AdminCargoDetailDto,
  type AdminCargoIssue,
  type AdminCargoRoundDetailDto,
  type AdminCargoRoundRowDto,
  type AdminCargoRoundSummaryDto,
  type AdminCargoRowDto,
  type AdminItemDto,
  type AdminPageDto,
  type CargoImageKind,
  type CargoRoundStatus,
  type ItemDto,
} from '@gunraid/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ExternalLink,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  cargoApiFieldErrors,
  cargoConflictKey,
  cargoDraftBody,
  cargoDraftErrors,
  cargoDraftFrom,
  cargoDraftRtp,
  cargoImageKind,
  digitsOnly,
  durationHours,
  firstErrorField,
  fitSeatPrice,
  formatCargoRanges,
  newCargoDraft,
  nextSortOrder,
  sameCargoDraft,
  type CargoDraft,
  type CargoField,
  type CargoFieldErrors,
} from '@/app/admin/cargo/cargo-form';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { GemAmount } from '@/components/ui/gem';
import { Field, Input } from '@/components/ui/input';
import { ItemCard } from '@/components/ui/item-card';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import {
  AdminSection,
  AdminTable,
  Pager,
  Select,
  StatCard,
  Switch,
  TextArea,
  fmtDate,
  pct,
  useDebounced,
} from './ui';

/*
 * Грузы в админке (§A.3): список шаблонов игры с архивом, редактор шаблона, текущий раунд с участниками и
 * отменой (возврат гемов, D33), история раундов. Только admin — страницы обёрнуты в AdminOnly, API отвечает 403
 * support и игрокам. Тексты — admin.cargo.*; ошибки API — текстом (errors.* и admin.cargo.errors.*), не кодом.
 */

const fmtInt = (n: number) => n.toLocaleString('ru-RU');
/**
 * Фокус с клавиатуры. У кнопок со срезанными углами clip-path срезает обычный внешний контур (:focus-visible),
 * поэтому контур рисуется внутри кнопки цветом её текста (виден на лаймовой, красной и тёмной); у списков —
 * кольцо внутри.
 */
const FOCUS = 'focus-visible:outline-current focus-visible:outline-offset-[-4px]';
const SELECT_FOCUS = 'focus-visible:ring-inset';
/** Выключенное поле (архив, бесплатный груз) — заметно бледнее. */
const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-60';
/** Клик по ссылке или кнопке внутри строки таблицы не должен срабатывать как клик по строке. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const listHref = (game: string, archived = false) =>
  `/admin/cargo?game=${game}${archived ? '&archived=1' : ''}`;
const editHref = (id: string, game: string) => `/admin/cargo/${id}?game=${game}`;
/** У отменённого и закрытого по минимуму раунда оплата вернулась участникам. */
const refundedRound = (r: { status: CargoRoundStatus; landReason: string | null }) =>
  r.status === 'cancelled' || (r.status === 'expired' && r.landReason === 'min_seats');

const ROUND_TONES: Record<CargoRoundStatus, 'soft' | 'info' | 'neutral' | 'warning'> = {
  open: 'soft',
  landed: 'info',
  expired: 'neutral',
  cancelled: 'warning',
};

/** Текст ошибки API: CONFLICT с причиной (архив, открытый раунд, раунд занят) — свой, остальное — по коду. */
function useCargoErrorText() {
  const t = useTranslations('admin.cargo');
  const errorText = useErrorMessage();
  return useCallback(
    (err: unknown) => {
      const key = err instanceof ApiError ? cargoConflictKey(err.code, err.details) : null;
      return key ? t(`errors.${key}`) : errorText(err);
    },
    [t, errorText],
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const tr = useTranslations('common');
  const errorText = useErrorMessage();
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <p role="alert" className="flex items-center gap-2 text-sm text-danger">
        <AlertTriangle size={16} aria-hidden="true" /> {errorText(error)}
      </p>
      <Button className={FOCUS} size="sm" variant="secondary" onClick={onRetry}>
        {tr('retry')}
      </Button>
    </Card>
  );
}

function CargoGameSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tc = useTranslations('admin.common');
  const config = useConfig();
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={tc('game')}
      className={SELECT_FOCUS}
    >
      {config.games.map((g) => (
        <option key={g.code} value={g.code}>
          {g.name}
        </option>
      ))}
    </Select>
  );
}

/** Предмет строкой: картинка, название цветом редкости, цена (или снимок цены раунда). */
function PrizeLine({ item, value, compact }: { item: ItemDto; value?: number; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-7 w-10 shrink-0 object-contain" />
      ) : (
        <span className="h-7 w-10 shrink-0 bg-surface-3" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-col gap-1.5">
        <span
          className={cn('block truncate text-sm', compact ? 'max-w-[170px]' : 'max-w-[240px]')}
          style={{ color: item.rarity.color }}
          title={item.fullName}
        >
          {item.fullName}
        </span>
        <GemAmount value={value ?? item.price} size="xs" className="text-muted" />
      </span>
    </span>
  );
}

function IssueBadge({ issue }: { issue: AdminCargoIssue }) {
  const t = useTranslations('admin.cargo');
  return (
    <Badge tone={issue === 'LANDING_STUCK' ? 'danger' : 'warning'} title={t(`issues.${issue}`)}>
      <AlertTriangle size={11} aria-hidden="true" /> {t(`issuesShort.${issue}`)}
    </Badge>
  );
}

function TemplateBadge({ cargo }: { cargo: AdminCargoRowDto }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  if (cargo.archivedAt) return <Badge>{t('archivedBadge')}</Badge>;
  return (
    <Badge tone={cargo.isActive ? 'soft' : 'neutral'}>
      {cargo.isActive ? tc('active') : tc('inactive')}
    </Badge>
  );
}

function RoundStatusBadge({ status }: { status: CargoRoundStatus }) {
  const t = useTranslations('admin.cargo');
  return <Badge tone={ROUND_TONES[status]}>{t(`statuses.${status}`)}</Badge>;
}

/** RTP при текущих продажах: больше 100 % — красным и со значком (приз дороже выручки). */
function RtpNow({ value }: { value: number | null }) {
  const over = value !== null && value > 1;
  return (
    <span className={cn('inline-flex items-center gap-1', over && 'text-danger')}>
      {over && <AlertTriangle size={12} aria-hidden="true" />}
      {pct(value)}
    </span>
  );
}

// ---------- Список ----------

/**
 * Список грузов игры. Игра и архив — в адресе (?game=, ?archived=1): их читает список при открытии и пишет при
 * смене, поэтому «Назад» из редактора и «К списку грузов» возвращают тот же список.
 */
export function AdminCargo() {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const params = useSearchParams();
  const config = useConfig();
  const [game, setGame] = useState(() => {
    const fromUrl = params.get('game');
    return fromUrl && config.games.some((g) => g.code === fromUrl) ? fromUrl : config.defaultGame;
  });
  const [archived, setArchived] = useState(() => params.get('archived') === '1');
  useEffect(() => {
    window.history.replaceState(null, '', listHref(game, archived));
  }, [game, archived]);
  const list = useQuery({
    queryKey: ['admin', 'cargo', game, archived],
    queryFn: () =>
      api.get<AdminCargoRowDto[]>(`/admin/games/${game}/cargo${archived ? '?archived=1' : ''}`),
    // Продажи и раунды меняются сами — список обновляется, пока открыт.
    refetchInterval: 15_000,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('title')}</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <CargoGameSelect value={game} onChange={setGame} />
          <span data-testid="admin-cargo-archived">
            <Switch checked={archived} onChange={setArchived} label={t('showArchived')} />
          </span>
          <Button className={FOCUS} asChild>
            <Link href={`/admin/cargo/new?game=${game}`} data-testid="admin-cargo-new">
              <Plus size={16} /> {t('new')}
            </Link>
          </Button>
        </div>
      </div>
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-64" />
      ) : (
        <AdminTable
          rows={list.data}
          rowKey={(c) => c.id}
          empty={t('empty')}
          onRowClick={(c) => router.push(editHref(c.id, c.game))}
          columns={[
            {
              key: 'name',
              title: t('columns.cargo'),
              render: (c) => (
                <span className={cn('flex items-center gap-2.5', c.archivedAt && 'opacity-60')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cargoImageVariant(c.imageUrl, 256)}
                    alt=""
                    className="h-9 w-9 shrink-0 object-contain"
                  />
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <Link
                      href={editHref(c.id, c.game)}
                      onClick={stop}
                      className="block max-w-[220px] truncate font-semibold hover:text-accent"
                    >
                      {c.name}
                    </Link>
                    <span className="font-mono text-[11px] text-dim" data-testid="admin-cargo-slug">
                      {c.slug}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'prize',
              title: t('columns.prize'),
              render: (c) => <PrizeLine item={c.prize} />,
            },
            {
              key: 'price',
              title: t('columns.seatPrice'),
              className: 'text-right',
              render: (c) =>
                c.seatPrice > 0 ? (
                  <GemAmount value={c.seatPrice} size="sm" />
                ) : (
                  <span className="text-xs font-semibold uppercase text-accent">
                    {t('freePrice')}
                  </span>
                ),
            },
            {
              key: 'sold',
              title: t('columns.sold'),
              className: 'whitespace-nowrap text-right tabular',
              render: (c) =>
                c.round ? `${fmtInt(c.round.seatsSold)}/${fmtInt(c.round.seatsTotal)}` : tc('none'),
            },
            {
              key: 'ends',
              title: t('columns.endsIn'),
              className: 'whitespace-nowrap tabular',
              render: (c) =>
                c.round ? <Countdown to={c.round.endsAt} className="tabular" /> : tc('none'),
            },
            {
              key: 'rtp',
              title: t('columns.rtp'),
              className: 'whitespace-nowrap text-right tabular',
              render: (c) => (
                <span className="flex flex-col items-end gap-1.5">
                  <span className={cn(c.rtp !== null && c.rtp > 1 && 'text-danger')}>
                    {pct(c.rtp)}
                  </span>
                  {c.round && (
                    <span className="text-[11px] text-dim">
                      {t('rtpNowShort')} <RtpNow value={c.round.rtpNow} />
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'status',
              title: tc('status'),
              render: (c) => (
                <span className="flex flex-wrap items-center gap-1">
                  <TemplateBadge cargo={c} />
                  {c.issue && <IssueBadge issue={c.issue} />}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

// ---------- Редактор ----------

const fieldId = (f: CargoField) => `cargo-${f}`;

/** Блок формы с заголовком; блоки разделены линией. */
function FormBlock({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      {title && <h3 className="font-display text-sm font-bold uppercase tracking-wide">{title}</h3>}
      {children}
    </section>
  );
}

export function AdminCargoEditor({ id, game: gameParam }: { id: string | null; game: string }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const qc = useQueryClient();
  const errorText = useCargoErrorText();
  const detail = useQuery({
    queryKey: ['admin', 'cargo-template', id],
    enabled: Boolean(id),
    queryFn: () => api.get<AdminCargoDetailDto>(`/admin/cargo/${id}`),
    // Продажи текущего раунда меняются — сводка обновляется сама; форма при этом не сбрасывается.
    refetchInterval: 10_000,
  });
  const cargo = detail.data;
  // Игра — из шаблона (ссылка из аудита приходит без ?game=), у нового — из адреса.
  const game = cargo?.game ?? gameParam;
  const siblings = useQuery({
    queryKey: ['admin', 'cargo', game, false],
    enabled: !id,
    queryFn: () => api.get<AdminCargoRowDto[]>(`/admin/games/${game}/cargo`),
  });
  const [draft, setDraft] = useState<CargoDraft>(() => newCargoDraft());
  // Текущий черновик для эффекта ниже (эффекты идут по порядку: этот — раньше).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [sortTouched, setSortTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<CargoFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const loaded = useRef<string | null>(null);
  /** Шаблон, из которого форма заполнена последний раз; null — заполнить заново (после своего сохранения). */
  const base = useRef<CargoDraft | null>(null);

  useEffect(() => {
    if (!cargo) return;
    // Форма заполняется заново, только когда изменился сам шаблон, а не на каждом опросе продаж. Чужая правка
    // (другая вкладка, другой админ) не затирает несохранённые изменения: форма остаётся как есть.
    const stamp = `${cargo.id}:${cargo.updatedAt}`;
    if (loaded.current === stamp) return;
    loaded.current = stamp;
    const next = cargoDraftFrom(cargo);
    const prev = base.current;
    base.current = next;
    if (prev && !sameCargoDraft(draftRef.current, prev)) return;
    setDraft(next);
    setServerErrors({});
    setShowErrors(false);
  }, [cargo]);

  useEffect(() => {
    // Новый груз — в конец списка игры (первый по порядку открывается по /{game}/cargo).
    if (id || sortTouched || !siblings.data) return;
    const sortOrder = String(nextSortOrder(siblings.data));
    setDraft((d) => ({ ...d, sortOrder }));
  }, [id, sortTouched, siblings.data]);

  // Раунд сменился (приземлился, отменён, открыт) — история раундов устарела.
  const roundId = cargo ? (cargo.round?.id ?? null) : undefined;
  const lastRound = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (roundId === undefined) return;
    if (lastRound.current !== undefined && lastRound.current !== roundId) {
      void qc.invalidateQueries({ queryKey: ['admin', 'cargo-rounds', id] });
    }
    lastRound.current = roundId;
  }, [roundId, id, qc]);

  const clientErrors = useMemo(() => cargoDraftErrors(draft), [draft]);
  const errors: CargoFieldErrors = showErrors ? { ...clientErrors, ...serverErrors } : serverErrors;
  const errorOf = (f: CargoField): string | undefined => {
    const e = errors[f];
    if (!e) return undefined;
    const values = Object.fromEntries(
      Object.entries(e.values ?? {}).map(([k, v]) => [k, fmtInt(v)]),
    );
    return t(`errors.${e.key}`, values);
  };
  const set = <K extends keyof CargoDraft>(k: K, v: CargoDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setServerErrors({});
  };
  const focusField = (f: CargoField) => document.getElementById(fieldId(f))?.focus();

  const rtp = cargoDraftRtp(draft);
  const hours = durationHours(draft.durationMinutes);
  const seats = Number(draft.seatsTotal);
  const canFit = Boolean(draft.prize) && Number.isInteger(seats) && seats >= 2;
  const kind = cargoImageKind(draft.imageUrl);
  // Свой путь из БД (не стандартный вид) остаётся отдельной опцией, чтобы правка его не теряла.
  const customImage = cargo && !cargoImageKind(cargo.imageUrl) ? cargo.imageUrl : null;
  const readOnly = Boolean(cargo?.archivedAt);

  const save = async () => {
    const first = firstErrorField(clientErrors);
    const body = first ? null : cargoDraftBody(draft);
    if (!body) {
      setShowErrors(true);
      toast.error(t('errors.form'));
      if (first) focusField(first);
      return;
    }
    setBusy(true);
    try {
      if (id) {
        const updated = await api.put<AdminCargoDetailDto>(
          `/admin/games/${game}/cargo/${id}`,
          body,
        );
        // Своё сохранение — форма заполняется ответом сервера (нормализованные значения: лимит 1 у бесплатного).
        base.current = null;
        qc.setQueryData(['admin', 'cargo-template', id], updated);
      } else {
        const created = await api.post<AdminCargoDetailDto>(`/admin/games/${game}/cargo`, body);
        qc.setQueryData(['admin', 'cargo-template', created.id], created);
        router.replace(editHref(created.id, game));
      }
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'cargo'] });
    } catch (err) {
      const fields =
        err instanceof ApiError ? cargoApiFieldErrors(err.code, err.details, draft) : {};
      setServerErrors(fields);
      toast.error(errorText(err));
      const f = firstErrorField(fields);
      if (f) focusField(f);
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: ['admin', 'cargo-template', id] });
      }
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!id) return;
    setArchiving(true);
    try {
      const archived = await api.delete<AdminCargoDetailDto>(`/admin/cargo/${id}`);
      // Сразу архивная версия: открыв груз снова, админ не увидит прежнюю форму с кнопкой «Сохранить».
      qc.setQueryData(['admin', 'cargo-template', id], archived);
      toast.success(t('archived'));
      await qc.invalidateQueries({ queryKey: ['admin', 'cargo'] });
      router.push(listHref(game));
    } catch (err) {
      toast.error(errorText(err));
      setArchiveOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'cargo-template', id] });
    } finally {
      setArchiving(false);
    }
  };

  if (id && !cargo) {
    return detail.isError ? (
      <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
    ) : (
      <Skeleton className="h-96" />
    );
  }

  const intInput = (
    f: Exclude<CargoField, 'name' | 'slug' | 'imageUrl' | 'prize'>,
    props: { disabled?: boolean; shown?: string; onInput?: () => void } = {},
  ) => (
    <Input
      id={fieldId(f)}
      inputMode="numeric"
      autoComplete="off"
      value={props.shown ?? draft[f]}
      disabled={props.disabled}
      invalid={Boolean(errorOf(f))}
      onChange={(e) => {
        props.onInput?.();
        set(f, digitsOnly(e.target.value));
      }}
      className={cn('h-10 tabular', DISABLED)}
    />
  );

  return (
    <div className="space-y-5">
      <Link
        href={listHref(game)}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <SectionTitle
        action={
          cargo && (
            <span className="flex flex-wrap items-center justify-end gap-2">
              <TemplateBadge cargo={cargo} />
              {cargo.round && (
                <Link
                  href={`/${cargo.game}/cargo/${cargo.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                >
                  <ExternalLink size={14} aria-hidden="true" /> {t('openOnSite')}
                </Link>
              )}
            </span>
          )
        }
      >
        {cargo?.name ?? t('new')}
      </SectionTitle>

      {cargo?.issue && (
        <p
          role="status"
          className={cn(
            'clip-cut flex items-start gap-2 p-3 text-sm [--cut:6px]',
            cargo.issue === 'LANDING_STUCK'
              ? 'bg-danger/10 text-danger'
              : 'bg-warning/10 text-warning',
          )}
          data-testid="admin-cargo-issue"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(`issues.${cargo.issue}`)}
        </p>
      )}
      {readOnly && (
        <p className="clip-cut bg-surface-2 p-3 text-sm text-muted [--cut:6px]">
          {t('archivedHint')}
        </p>
      )}

      <Card className="space-y-5 p-4">
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
          <FormBlock title={t('sections.main')}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label={t('fields.name')} htmlFor={fieldId('name')} error={errorOf('name')}>
                <Input
                  id={fieldId('name')}
                  value={draft.name}
                  maxLength={80}
                  autoComplete="off"
                  invalid={Boolean(errorOf('name'))}
                  onChange={(e) => set('name', e.target.value)}
                  className={cn('h-10', DISABLED)}
                />
              </Field>
              <Field
                label={t('fields.slug')}
                htmlFor={fieldId('slug')}
                error={errorOf('slug')}
                hint={draft.slug ? t('slugHint', { game, slug: draft.slug }) : undefined}
              >
                <Input
                  id={fieldId('slug')}
                  value={draft.slug}
                  maxLength={80}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={Boolean(errorOf('slug'))}
                  onChange={(e) =>
                    set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }
                  className={cn('h-10 font-mono', DISABLED)}
                />
              </Field>
              <Field
                label={t('fields.image')}
                htmlFor={fieldId('imageUrl')}
                error={errorOf('imageUrl')}
              >
                <span className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cargoImageVariant(draft.imageUrl, 256)}
                    alt=""
                    className="h-10 w-10 shrink-0 object-contain"
                  />
                  <Select
                    id={fieldId('imageUrl')}
                    value={kind ?? 'custom'}
                    onChange={(e) => {
                      const v = e.target.value;
                      set(
                        'imageUrl',
                        v === 'custom' && customImage
                          ? customImage
                          : cargoImageUrl(v as CargoImageKind),
                      );
                    }}
                    className={cn('w-full', DISABLED, SELECT_FOCUS)}
                  >
                    {CARGO_IMAGE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`images.${k}`)}
                      </option>
                    ))}
                    {customImage && (
                      <option value="custom">{t('images.custom', { path: customImage })}</option>
                    )}
                  </Select>
                </span>
              </Field>
              <Field
                label={t('fields.sortOrder')}
                htmlFor={fieldId('sortOrder')}
                error={errorOf('sortOrder')}
              >
                {intInput('sortOrder', { onInput: () => setSortTouched(true) })}
              </Field>
            </div>
            <Switch
              disabled={readOnly}
              checked={draft.isActive}
              onChange={(v) => set('isActive', v)}
              label={t('fields.isActive')}
            />
          </FormBlock>

          <FormBlock title={<label htmlFor={fieldId('prize')}>{t('fields.prize')}</label>}>
            <CargoPrizePicker
              game={game}
              value={draft.prize}
              invalid={Boolean(errorOf('prize'))}
              inactive={cargo?.issue === 'PRIZE_INACTIVE' && draft.prize?.id === cargo.prize.id}
              onChange={(item) => set('prize', item)}
            />
            {errorOf('prize') && (
              <p className="text-xs text-danger" role="alert">
                {errorOf('prize')}
              </p>
            )}
          </FormBlock>

          <FormBlock title={t('sections.seats')}>
            <span data-testid="admin-cargo-free" className="inline-flex">
              <Switch
                disabled={readOnly}
                checked={draft.free}
                onChange={(v) => set('free', v)}
                label={t('fields.free')}
              />
            </span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Field
                label={t('fields.seatsTotal')}
                htmlFor={fieldId('seatsTotal')}
                error={errorOf('seatsTotal')}
              >
                {intInput('seatsTotal')}
              </Field>
              <Field
                label={t('fields.seatPrice')}
                htmlFor={fieldId('seatPrice')}
                error={errorOf('seatPrice')}
              >
                {intInput('seatPrice', {
                  disabled: draft.free,
                  shown: draft.free ? '0' : undefined,
                })}
              </Field>
              <Field
                label={t('fields.perUserLimit')}
                htmlFor={fieldId('perUserLimit')}
                error={errorOf('perUserLimit')}
                hint={draft.free ? undefined : t('noLimit')}
              >
                {intInput('perUserLimit', {
                  disabled: draft.free,
                  shown: draft.free ? '1' : undefined,
                })}
              </Field>
              <Field
                label={t('fields.durationMinutes')}
                htmlFor={fieldId('durationMinutes')}
                error={errorOf('durationMinutes')}
                hint={
                  hours !== null ? t('hours', { hours: hours.toLocaleString('ru-RU') }) : undefined
                }
              >
                {intInput('durationMinutes')}
              </Field>
              <Field
                label={t('fields.minSeatsToLand')}
                htmlFor={fieldId('minSeatsToLand')}
                error={errorOf('minSeatsToLand')}
                hint={t('noMinimum')}
              >
                {intInput('minSeatsToLand')}
              </Field>
            </div>
            <p className="text-xs text-dim">{t('minSeatsHint')}</p>
          </FormBlock>

          <FormBlock title={t('sections.conditions')}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field
                label={t('fields.minLevel')}
                htmlFor={fieldId('minLevel')}
                error={errorOf('minLevel')}
                hint={t('noCondition')}
              >
                {intInput('minLevel')}
              </Field>
              <Field
                label={t('fields.depositWithinDays')}
                htmlFor={fieldId('depositWithinDays')}
                error={errorOf('depositWithinDays')}
                hint={t('noCondition')}
              >
                {intInput('depositWithinDays')}
              </Field>
            </div>
            {draft.free && <p className="text-xs text-warning">{t('freeHint')}</p>}
          </FormBlock>

          <FormBlock>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <div
                className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]"
                data-testid="admin-cargo-rtp"
              >
                <div className="text-[11px] uppercase tracking-wider text-dim">{t('rtp')}</div>
                <div
                  className={cn(
                    'font-display text-xl font-bold tabular',
                    rtp !== null && rtp > 1 && 'text-danger',
                  )}
                >
                  {draft.free ? tc('none') : pct(rtp)}
                </div>
                <div className="text-[11px] text-muted">
                  {draft.free ? t('rtpFree') : t('rtpHint')}
                </div>
                {!draft.free && (
                  <Button
                    className={FOCUS}
                    size="sm"
                    variant="secondary"
                    disabled={!canFit}
                    onClick={() =>
                      draft.prize &&
                      set('seatPrice', String(fitSeatPrice(draft.prize.price, seats)))
                    }
                  >
                    <Sparkles size={14} /> {t('fitPrice')}
                  </Button>
                )}
              </div>
              <ul className="space-y-1.5 self-center text-xs text-dim">
                {id && !readOnly && <li>{t('nextRoundHint')}</li>}
                {!draft.isActive && !readOnly && <li>{t('inactiveHint')}</li>}
                {!id && draft.isActive && <li>{t('activeNewHint')}</li>}
              </ul>
            </div>
          </FormBlock>
        </fieldset>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className={FOCUS}
              loading={busy}
              onClick={() => void save()}
              data-testid="admin-cargo-save"
            >
              {id ? tc('save') : tc('create')}
            </Button>
            {cargo && (
              <>
                <Button
                  className={FOCUS}
                  variant="secondary"
                  disabled={Boolean(cargo.round)}
                  onClick={() => setArchiveOpen(true)}
                  data-testid="admin-cargo-archive"
                >
                  <Archive size={16} /> {t('archive')}
                </Button>
                {cargo.round && (
                  <span className="text-xs text-dim" data-testid="admin-cargo-archive-blocked">
                    {cargo.isActive ? t('archiveBlocked') : t('archiveBlockedInactive')}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {cargo && !readOnly && <CargoCurrentRound cargo={cargo} />}
      {cargo && <CargoRoundsHistory cargoId={cargo.id} />}

      <Modal
        open={archiveOpen}
        onOpenChange={(v) => !archiving && setArchiveOpen(v)}
        title={t('archiveTitle')}
        description={t('archiveText')}
        size="sm"
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            className={FOCUS}
            variant="secondary"
            disabled={archiving}
            onClick={() => setArchiveOpen(false)}
          >
            {tc('cancel')}
          </Button>
          <Button
            className={FOCUS}
            variant="danger"
            loading={archiving}
            onClick={() => void archive()}
            data-testid="admin-cargo-archive-confirm"
          >
            {t('archiveConfirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Выбор приза ----------

/**
 * Приз — поиском по активным предметам игры (от 2 букв). Выбранный — карточкой; после выбора поиск очищается, фокус
 * возвращается в поле поиска.
 */
export function CargoPrizePicker({
  game,
  value,
  onChange,
  invalid,
  inactive,
}: {
  game: string;
  value: ItemDto | null;
  onChange: (item: ItemDto) => void;
  invalid?: boolean;
  /** Выбранный приз выключен в каталоге (issue PRIZE_INACTIVE). */
  inactive?: boolean;
}) {
  const t = useTranslations('admin.cargo');
  const errorText = useErrorMessage();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(search.trim());
  const found = useQuery({
    queryKey: ['admin', 'items-search', game, q, 'active'],
    enabled: q.length >= 2,
    queryFn: () =>
      api.get<AdminPageDto<AdminItemDto>>(
        `/admin/games/${game}/items?q=${encodeURIComponent(q)}&active=1&pageSize=8`,
      ),
  });
  const pick = (item: AdminItemDto) => {
    onChange(item);
    setPicked(item.fullName);
    setSearch('');
    inputRef.current?.focus();
  };
  const searching = search.trim().length >= 2;
  return (
    <div className="grid gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
      <div className="w-[168px]">
        {value ? (
          <ItemCard
            size="sm"
            name={value.modelName ?? value.fullName}
            skin={value.skinName}
            imageUrl={value.imageUrl}
            rarityColor={value.rarity.color}
            rarityName={value.modelName ?? value.rarity.name}
            price={value.price}
            dimmed={inactive}
          />
        ) : (
          <div className="clip-cut grid h-[136px] place-items-center bg-surface-2 p-3 text-center text-xs text-dim [--cut:6px]">
            {t('prizeEmpty')}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <Input
          ref={inputRef}
          id={fieldId('prize')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPrize')}
          autoComplete="off"
          invalid={invalid}
          className={cn('h-10', DISABLED)}
          data-testid="admin-cargo-prize-search"
        />
        {inactive && <p className="text-xs text-warning">{t('prizeInactive')}</p>}
        {searching &&
          (found.isError ? (
            <p role="alert" className="text-xs text-danger">
              {errorText(found.error)}
            </p>
          ) : !found.data || q !== search.trim() ? (
            <p className="text-xs text-dim">{t('prizeSearching')}</p>
          ) : found.data.items.length === 0 ? (
            <p className="text-xs text-dim">{t('prizeNotFound')}</p>
          ) : (
            <ul className="grid gap-1.5 lg:grid-cols-2">
              {found.data.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => pick(it)}
                    aria-pressed={value?.id === it.id}
                    className={cn(
                      'clip-cut flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left text-sm outline-none hover:bg-surface-3 [--cut:6px]',
                      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                      value?.id === it.id && 'bg-accent-soft',
                    )}
                    data-testid="admin-cargo-prize-option"
                  >
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" className="h-6 w-9 shrink-0 object-contain" />
                    ) : (
                      <span className="h-6 w-9 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate" style={{ color: it.rarity.color }}>
                      {it.fullName}
                    </span>
                    <GemAmount value={it.price} size="xs" />
                  </button>
                </li>
              ))}
            </ul>
          ))}
        <p className="sr-only" aria-live="polite">
          {picked ? t('prizeSelected', { name: picked }) : ''}
        </p>
      </div>
    </div>
  );
}

// ---------- Текущий раунд ----------

function ParticipantsTable({ round }: { round: AdminCargoRoundDetailDto }) {
  const t = useTranslations('admin.cargo');
  const anyRefunded = round.participants.some((p) => p.refunded);
  return (
    <AdminTable
      rows={round.participants}
      rowKey={(p) => p.user.id}
      empty={t('noParticipants')}
      columns={[
        {
          key: 'user',
          title: t('player'),
          render: (p) => (
            <span className="flex items-center gap-2">
              <Avatar src={p.user.avatarUrl} name={p.user.nickname} size="xs" />
              <Link
                href={`/admin/users/${p.user.id}`}
                className="max-w-[200px] truncate font-semibold hover:text-accent"
              >
                {p.user.nickname}
              </Link>
              <span className="text-[11px] text-dim">ID {p.user.shortId}</span>
              {round.winner?.id === p.user.id && <Badge tone="accent">{t('winner')}</Badge>}
            </span>
          ),
        },
        {
          key: 'seats',
          title: t('seats'),
          className: 'text-right tabular',
          render: (p) => fmtInt(p.seats),
        },
        {
          key: 'ranges',
          title: t('ranges'),
          className: 'text-xs tabular',
          render: (p) => {
            const r = formatCargoRanges(p.ranges);
            return (
              <span>
                {r.text}
                {r.more > 0 && (
                  <span className="text-dim"> {t('rangesMore', { count: r.more })}</span>
                )}
              </span>
            );
          },
        },
        {
          key: 'spent',
          title: t('spent'),
          className: 'text-right',
          render: (p) => <GemAmount value={p.spent} size="sm" />,
        },
        {
          key: 'chance',
          title: t('chance'),
          className: 'text-right tabular',
          render: (p) => pct(round.seatsSold ? p.seats / round.seatsSold : null, 2),
        },
        {
          key: 'first',
          title: t('firstAt'),
          className: 'whitespace-nowrap text-xs text-muted',
          render: (p) => fmtDate(p.firstAt),
        },
        ...(anyRefunded
          ? [
              {
                key: 'refunded',
                title: t('refunded'),
                render: (p: AdminCargoRoundDetailDto['participants'][number]) =>
                  p.refunded ? <Badge tone="warning">{t('refundedShort')}</Badge> : null,
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * Открытый раунд шаблона: продажи, выручка, срок, участники, RTP при текущих продажах, ошибка приземления, хэш
 * server seed, отмена с возвратом гемов. Сводка — из детальной шаблона (опрос 10 с), участники — отдельным запросом.
 */
export function CargoCurrentRound({ cargo }: { cargo: AdminCargoDetailDto }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  const round = cargo.round;
  const boxRef = useRef<HTMLDivElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState<AdminCargoRoundSummaryDto | null>(null);
  const participants = useQuery({
    queryKey: ['admin', 'cargo-round', round?.id],
    enabled: Boolean(round),
    queryFn: () => api.get<AdminCargoRoundDetailDto>(`/admin/cargo-rounds/${round!.id}`),
    refetchInterval: 10_000,
  });
  const stuck = cargo.issue === 'LANDING_STUCK';
  return (
    <div ref={boxRef} tabIndex={-1} className="outline-none" data-testid="admin-cargo-round">
      <AdminSection
        title={round ? t('currentRound', { number: round.number }) : t('noRound')}
        actions={
          round && (
            <Button
              className={FOCUS}
              size="sm"
              variant="danger"
              onClick={() => {
                setCancelFor(round);
                setCancelOpen(true);
              }}
              data-testid="admin-cargo-cancel"
            >
              {t('cancel')}
            </Button>
          )
        }
      >
        {!round ? (
          <Card className="p-4 text-sm text-muted">
            {cargo.isActive ? t(`issues.${cargo.issue ?? 'NO_ROUND'}`) : t('noRoundInactive')}
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label={t('sold')}
                value={
                  <span className="tabular">
                    {fmtInt(round.seatsSold)}/{fmtInt(round.seatsTotal)}
                  </span>
                }
                hint={
                  round.minSeatsToLand !== null
                    ? t('minSeatsProgress', {
                        sold: fmtInt(round.seatsSold),
                        min: fmtInt(round.minSeatsToLand),
                      })
                    : undefined
                }
              />
              <StatCard
                label={t('revenue')}
                value={<GemAmount value={round.revenue} size="lg" />}
                hint={
                  round.seatPrice > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      {t('fields.seatPrice')}: <GemAmount value={round.seatPrice} size="xs" />
                    </span>
                  ) : (
                    t('freePrice')
                  )
                }
              />
              <StatCard
                label={t('endsIn')}
                value={<Countdown to={round.endsAt} className="tabular" />}
                hint={t('endsAt', { date: fmtDate(round.endsAt) })}
              />
              <StatCard label={t('participants')} value={fmtInt(round.participants)} />
              <StatCard
                label={t('rtpNow')}
                value={<RtpNow value={round.rtpNow} />}
                hint={t('rtpNowHint')}
              />
              <StatCard
                label={t('roundPrize')}
                value={<PrizeLine item={round.prize} value={round.prizeValue} />}
                hint={t('prizeValueAtStart')}
              />
            </div>
            {round.landAttempts > 0 && (
              <div
                role="alert"
                className={cn(
                  'clip-cut space-y-1 p-3 text-sm [--cut:6px]',
                  stuck ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
                )}
                data-testid="admin-cargo-land-error"
              >
                <p className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {t('landAttempts', {
                      count: round.landAttempts,
                      error: round.lastLandError ?? tc('none'),
                    })}
                  </span>
                </p>
                {round.lastLandErrorAt && (
                  <p className="pl-6 text-xs opacity-80">
                    {t('landErrorAt', { date: fmtDate(round.lastLandErrorAt) })}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
                {t('seedHash')}
              </div>
              <code
                className="block break-all font-mono text-xs text-muted"
                data-testid="admin-cargo-seed-hash"
              >
                {round.serverSeedHash}
              </code>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
                {t('participants')}
              </div>
              {participants.isError ? (
                <LoadError error={participants.error} onRetry={() => void participants.refetch()} />
              ) : participants.data && participants.data.id === round.id ? (
                <ParticipantsTable round={participants.data} />
              ) : (
                <Skeleton className="h-24" />
              )}
            </div>
          </div>
        )}
      </AdminSection>
      <CancelRoundModal
        cargo={cargo}
        round={cancelFor}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        returnFocusRef={boxRef}
      />
    </div>
  );
}

/**
 * Отмена раунда с возвратом гемов (D33): сумма возврата, предупреждение о публичности (server seed раскроется — на
 * странице проверки будет видно, какое место выиграло бы), причина от 5 символов. Без idempotency key: повтор —
 * 409 CARGO_ROUND_NOT_OPEN.
 */
function CancelRoundModal({
  cargo,
  round,
  open,
  onClose,
  returnFocusRef,
}: {
  cargo: AdminCargoDetailDto;
  round: AdminCargoRoundSummaryDto | null;
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('admin.cargo');
  const tg = useTranslations('gems');
  const qc = useQueryClient();
  const errorText = useCargoErrorText();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const trimmed = reason.trim();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'cargo-template', cargo.id] }),
      qc.invalidateQueries({ queryKey: ['admin', 'cargo-rounds', cargo.id] }),
      qc.invalidateQueries({ queryKey: ['admin', 'cargo-round', round?.id] }),
      qc.invalidateQueries({ queryKey: ['admin', 'cargo', cargo.game] }),
    ]);
  const submit = async () => {
    if (!round || trimmed.length < 5) return;
    setBusy(true);
    try {
      await api.post<AdminCargoRoundDetailDto>(`/admin/cargo-rounds/${round.id}/cancel`, {
        reason: trimmed,
      });
      toast.success(t('cancelled'));
      // Сначала свежие данные, потом закрыть: фокус вернётся на кнопку, если раунд остался (груз включён), иначе —
      // на блок раунда.
      await refresh();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
      if (err instanceof ApiError && err.code === 'CARGO_ROUND_NOT_OPEN') {
        await refresh();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };
  const text = !round
    ? ''
    : round.seatsSold === 0
      ? t('cancelTextEmpty')
      : round.revenue === 0
        ? t('cancelTextFree', { participants: round.participants })
        : t('cancelText', {
            participants: round.participants,
            gems: tg('amount', { count: round.revenue }),
          });
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={round ? t('cancelTitle', { number: round.number }) : t('cancel')}
      description={text}
      size="lg"
      returnFocusRef={returnFocusRef}
    >
      <div className="space-y-4" data-testid="admin-cargo-cancel-modal">
        <p
          id="cargo-cancel-public"
          className="clip-cut flex items-start gap-2 bg-warning/10 p-3 text-sm text-warning [--cut:6px]"
          data-testid="admin-cargo-cancel-public"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('cancelPublic')}
        </p>
        {cargo.isActive && (
          <p id="cargo-cancel-next" className="text-xs text-muted">
            {t('cancelNext')}
          </p>
        )}
        <div className="space-y-1.5">
          <label
            htmlFor="cargo-cancel-reason"
            className="text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {t('cancelReason')}
          </label>
          <TextArea
            id="cargo-cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={[
              'cargo-cancel-public',
              cargo.isActive ? 'cargo-cancel-next' : null,
              'cargo-cancel-count',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid="admin-cargo-cancel-reason"
          />
          <p id="cargo-cancel-count" className="text-xs text-dim">
            {t('cancelReasonHint', { count: trimmed.length })}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button className={FOCUS} variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancelKeep')}
          </Button>
          <Button
            className={FOCUS}
            variant="danger"
            loading={busy}
            disabled={trimmed.length < 5}
            onClick={() => void submit()}
            data-testid="admin-cargo-cancel-confirm"
          >
            {t('cancelConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- История раундов ----------

/** Место раунда: выигравшее или (у отменённого и закрытого по минимуму) то, что выиграло бы. */
function SeatCell({ round }: { round: AdminCargoRoundRowDto }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  if (round.winningSeat !== null) return <>{t('seatNo', { seat: round.winningSeat })}</>;
  if (round.voidSeat !== null) {
    return <span className="text-dim">{t('voidSeat', { seat: round.voidSeat })}</span>;
  }
  return <>{tc('none')}</>;
}

/** Причина: как закрылся раунд или (у отменённого) причина отмены; в таблице — в одну строку, в окне — целиком. */
function ReasonCell({ round, full }: { round: AdminCargoRoundRowDto; full?: boolean }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  if (round.status === 'cancelled') {
    return (
      <span
        className={cn('block', full ? 'break-words' : 'max-w-[180px] truncate')}
        title={full ? undefined : (round.cancelReason ?? undefined)}
      >
        {round.cancelReason ? `«${round.cancelReason}»` : tc('none')}
      </span>
    );
  }
  return <>{round.landReason ? t(`landReasons.${round.landReason}`) : tc('none')}</>;
}

export function CargoRoundsHistory({ cargoId }: { cargoId: string }) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  const [status, setStatus] = useState<CargoRoundStatus | ''>('');
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState<AdminCargoRoundRowDto | null>(null);
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'cargo-rounds', cargoId, status, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminCargoRoundRowDto>>(
        `/admin/cargo/${cargoId}/rounds?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`,
      ),
    placeholderData: keepPreviousData,
  });
  const show = (r: AdminCargoRoundRowDto) => {
    setShown(r);
    setOpen(true);
  };
  return (
    <AdminSection
      title={t('history')}
      actions={
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as CargoRoundStatus | '');
            setPage(1);
          }}
          aria-label={tc('status')}
          className={SELECT_FOCUS}
          data-testid="admin-cargo-history-status"
        >
          <option value="">{tc('all')}</option>
          {CARGO_ROUND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
      }
    >
      <div className="space-y-3" data-testid="admin-cargo-history">
        {list.isError ? (
          <LoadError error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <AdminTable
              rows={list.data.items}
              rowKey={(r) => r.id}
              onRowClick={show}
              columns={[
                {
                  key: 'number',
                  title: t('round'),
                  render: (r) => (
                    <button
                      type="button"
                      onClick={(e) => {
                        stop(e);
                        show(r);
                      }}
                      aria-label={t('openRound', { number: r.number })}
                      className="font-semibold tabular underline-offset-4 hover:text-accent hover:underline"
                      data-testid="admin-cargo-round-open"
                    >
                      {t('roundNo', { number: r.number })}
                    </button>
                  ),
                },
                {
                  key: 'status',
                  title: tc('status'),
                  render: (r) => <RoundStatusBadge status={r.status} />,
                },
                {
                  key: 'sold',
                  title: t('sold'),
                  className: 'whitespace-nowrap text-right tabular',
                  render: (r) => `${fmtInt(r.seatsSold)}/${fmtInt(r.seatsTotal)}`,
                },
                {
                  key: 'revenue',
                  title: t('revenue'),
                  className: 'text-right',
                  render: (r) => (
                    <span className="flex flex-col items-end gap-1.5">
                      <GemAmount value={r.revenue} size="sm" />
                      {refundedRound(r) && r.revenue > 0 && (
                        <span className="text-[11px] text-dim">{t('refundedShort')}</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'prize',
                  title: t('columns.prize'),
                  render: (r) => <PrizeLine item={r.prize} value={r.prizeValue} compact />,
                },
                {
                  // Победитель и его место — в одной колонке: таблица помещается в ширину без прокрутки.
                  key: 'winner',
                  title: t('winnerSeat'),
                  className: 'whitespace-nowrap tabular',
                  render: (r) => (
                    <span className="flex flex-col gap-1.5">
                      {r.winner && (
                        <Link
                          href={`/admin/users/${r.winner.id}`}
                          onClick={stop}
                          className="block max-w-[150px] truncate font-semibold hover:text-accent"
                        >
                          {r.winner.nickname}
                        </Link>
                      )}
                      <span className={cn(r.winner && 'text-xs text-dim')}>
                        <SeatCell round={r} />
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'reason',
                  title: tc('reason'),
                  className: 'text-xs text-muted',
                  render: (r) => <ReasonCell round={r} />,
                },
                {
                  key: 'date',
                  title: t('finishedAt'),
                  className: 'whitespace-nowrap text-xs text-muted',
                  render: (r) => fmtDate(r.finishedAt),
                },
                {
                  key: 'proof',
                  title: <span className="sr-only">{t('proof')}</span>,
                  render: (r) => (
                    <Link
                      href={`/provably-fair?cargo=${r.id}`}
                      onClick={stop}
                      title={t('proof')}
                      aria-label={t('proofOf', { number: r.number })}
                      className="grid h-8 w-8 place-items-center text-accent hover:text-text"
                    >
                      <ShieldCheck size={16} aria-hidden="true" />
                    </Link>
                  ),
                },
              ]}
            />
            <Pager
              page={page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
            />
          </>
        )}
      </div>
      <CargoRoundModal round={shown} open={open} onClose={() => setOpen(false)} />
    </AdminSection>
  );
}

/** Раунд из истории: итог, хэш и проверка, участники с местами и суммами. */
function CargoRoundModal({
  round,
  open,
  onClose,
}: {
  round: AdminCargoRoundRowDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('admin.cargo');
  const tc = useTranslations('admin.common');
  const detail = useQuery({
    queryKey: ['admin', 'cargo-round', round?.id],
    enabled: open && Boolean(round),
    queryFn: () => api.get<AdminCargoRoundDetailDto>(`/admin/cargo-rounds/${round!.id}`),
  });
  const facts: Array<[string, React.ReactNode]> = round
    ? [
        [tc('status'), <RoundStatusBadge key="s" status={round.status} />],
        [t('sold'), `${fmtInt(round.seatsSold)}/${fmtInt(round.seatsTotal)}`],
        [t('revenue'), <GemAmount key="r" value={round.revenue} size="sm" />],
        [t('roundPrize'), <PrizeLine key="p" item={round.prize} value={round.prizeValue} />],
        [t('winner'), round.winner ? round.winner.nickname : tc('none')],
        [t('winningSeat'), <SeatCell key="seat" round={round} />],
        [tc('reason'), <ReasonCell key="reason" round={round} full />],
        [t('startedAt'), fmtDate(round.startedAt)],
        [t('finishedAt'), fmtDate(round.finishedAt)],
      ]
    : [];
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={round ? t('roundTitle', { number: round.number }) : t('round')}
      size="xl"
    >
      {round && (
        <div className="space-y-4" data-testid="admin-cargo-round-modal">
          <dl className="grid gap-x-4 gap-y-5 text-sm sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0 space-y-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-dim">
                  {label}
                </dt>
                <dd className="min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
              {t('seedHash')}
            </div>
            <code className="block break-all font-mono text-xs text-muted">
              {round.serverSeedHash}
            </code>
            <Link
              href={`/provably-fair?cargo=${round.id}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <ShieldCheck size={14} aria-hidden="true" /> {t('proof')}
            </Link>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
              {t('participants')}
            </div>
            {detail.isError ? (
              <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
            ) : detail.data ? (
              <ParticipantsTable round={detail.data} />
            ) : (
              <Skeleton className="h-24" />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
