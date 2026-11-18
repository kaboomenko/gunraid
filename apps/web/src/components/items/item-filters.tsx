'use client';

import { ITEM_SORTS, type ItemFacetsDto } from '@gunraid/shared';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';

function useQueryState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return { params, set };
}

function toggleCsv(current: string | null, value: string): string | null {
  const list = (current ?? '').split(',').filter(Boolean);
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return next.length ? next.join(',') : null;
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'clip-cut inline-flex h-8 items-center gap-2 px-3 text-xs font-semibold transition [--cut:5px]',
        active ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
      )}
      aria-pressed={active}
    >
      {color && <span className="h-2.5 w-2.5" style={{ background: color }} aria-hidden="true" />}
      {children}
    </button>
  );
}

function FilterPanel({ facets }: { facets: ItemFacetsDto }) {
  const t = useTranslations('items');
  const { params, set } = useQueryState();
  const [min, setMin] = useState(params.get('priceMin') ?? '');
  const [max, setMax] = useState(params.get('priceMax') ?? '');
  useEffect(() => {
    setMin(params.get('priceMin') ?? '');
    setMax(params.get('priceMax') ?? '');
  }, [params]);

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">{t('rarity')}</div>
        <div className="flex flex-wrap gap-1.5">
          {facets.rarities.map((r) => (
            <Chip
              key={r.code}
              color={r.color}
              active={(params.get('rarity') ?? '').split(',').includes(r.code)}
              onClick={() => set({ rarity: toggleCsv(params.get('rarity'), r.code) })}
            >
              {r.name}
            </Chip>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">{t('type')}</div>
        <div className="flex flex-wrap gap-1.5">
          {facets.types.map((ty) => (
            <Chip
              key={ty.code}
              active={(params.get('type') ?? '').split(',').includes(ty.code)}
              onClick={() => set({ type: toggleCsv(params.get('type'), ty.code), model: null })}
            >
              {ty.name}
            </Chip>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">{t('model')}</div>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {facets.models
            .filter((mo) => {
              const types = (params.get('type') ?? '').split(',').filter(Boolean);
              return !types.length || types.includes(mo.typeCode);
            })
            .map((mo) => (
              <Chip
                key={mo.code}
                active={(params.get('model') ?? '').split(',').includes(mo.code)}
                onClick={() => set({ model: toggleCsv(params.get('model'), mo.code) })}
              >
                {mo.name}
              </Chip>
            ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">{t('price')}</div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ priceMin: min.replace(/\D/g, '') || null, priceMax: max.replace(/\D/g, '') || null });
          }}
        >
          <Input className="h-9" inputMode="numeric" placeholder={`${t('priceFrom')} ${facets.priceMin}`} value={min} onChange={(e) => setMin(e.target.value)} />
          <Input className="h-9" inputMode="numeric" placeholder={`${t('priceTo')} ${facets.priceMax}`} value={max} onChange={(e) => setMax(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" className="h-9">
            {t('apply')}
          </Button>
        </form>
      </section>
      <label className="flex items-center justify-between gap-3 text-sm" htmlFor="st-only">
        {t('stattrak')}
        <Switch
          id="st-only"
          label={t('stattrak')}
          checked={params.get('stattrak') === 'true'}
          onCheckedChange={(v) => set({ stattrak: v ? 'true' : null })}
        />
      </label>
    </div>
  );
}

/** Фильтры каталога: на компьютере — колонка слева, на телефоне — шторка снизу. Состояние — в URL. */
export function ItemFilters({ facets }: { facets: ItemFacetsDto }) {
  const t = useTranslations('items');
  const { params, set } = useQueryState();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const active = ['rarity', 'type', 'model', 'priceMin', 'priceMax', 'stattrak', 'q'].some((k) => params.get(k));

  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q.trim()) set({ q: q.trim() || null });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-10 min-w-0 flex-1 sm:max-w-xs"
          maxLength={80}
        />
        <select
          aria-label={t('sort.label')}
          className="clip-cut h-10 bg-surface-2 px-3 text-sm text-text [--cut:7px]"
          value={params.get('sort') ?? 'price_desc'}
          onChange={(e) => set({ sort: e.target.value === 'price_desc' ? null : e.target.value })}
        >
          {ITEM_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
        <Button variant="secondary" className="lg:hidden" onClick={() => setOpen(true)}>
          <SlidersHorizontal size={16} /> {t('filters')}
        </Button>
        {active && (
          <Button
            variant="ghost"
            onClick={() => {
              setQ('');
              set({ rarity: null, type: null, model: null, priceMin: null, priceMax: null, stattrak: null, q: null });
            }}
          >
            <X size={16} /> {t('reset')}
          </Button>
        )}
      </div>
      <Modal open={open} onOpenChange={setOpen} title={t('filters')}>
        <FilterPanel facets={facets} />
      </Modal>
    </>
  );
}

export function ItemFiltersSidebar({ facets }: { facets: ItemFacetsDto }) {
  return (
    <aside className="cut hidden h-fit p-4 lg:block">
      <FilterPanel facets={facets} />
    </aside>
  );
}
