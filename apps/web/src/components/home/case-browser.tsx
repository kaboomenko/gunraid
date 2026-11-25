'use client';

import { ADRENALINE_LEVELS, type AdrenalineLevel, type CaseCategoryDto } from '@gunraid/shared';
import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DropdownMenu } from 'radix-ui';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  AdrenalineExtremeIcon,
  AdrenalineHighIcon,
  AdrenalineIcon,
  AdrenalineLowIcon,
  AdrenalineNormalIcon,
  ChevronDownIcon,
  ClearIcon,
  GemIcon,
  SearchIcon,
} from '@/components/icons/design-icons';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { CaseTile } from './case-tile';

const LEVEL_ICONS: Record<AdrenalineLevel, ComponentType<{ size?: number }>> = {
  low: AdrenalineLowIcon,
  normal: AdrenalineNormalIcon,
  high: AdrenalineHighIcon,
  extreme: AdrenalineExtremeIcon,
};

/**
 * Внутренний фрейм фильтров (макет): высота 72 (24 + иконка 24 + 24), скругление 12, #26262F,
 * контур белый 20% 1px внутрь, текст и иконки белые 20%, Medium 24, внутри отступ 24.
 */
const FRAME =
  'flex h-[72px] items-center gap-6 rounded-[12px] bg-[#26262f] px-6 text-[24px] font-medium text-white/20 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]';

/** Меню фильтра — того же вида, что меню выбора игры. */
const MENU =
  'gr-pop z-50 flex flex-col gap-[6px] rounded-[24px] rounded-tl-[6px] bg-surface-1 p-3 shadow-[0_18px_48px_rgb(0_0_0/0.55)] outline-none';
const MENU_ITEM =
  'flex cursor-pointer select-none items-center gap-3 whitespace-nowrap rounded-[12px] bg-[#26262f] px-4 py-3 text-[20px] font-medium text-white outline-none transition-colors data-[highlighted]:bg-[#3e3e50]';

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  testId,
}: {
  label: string;
  value: T | 'all';
  options: Array<{ value: T | 'all'; label: string; icon?: ReactNode }>;
  onChange: (v: T | 'all') => void;
  icon?: ReactNode;
  testId: string;
}) {
  const selected = options.find((o) => o.value === value);
  const active = value !== 'all';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(FRAME, 'group shrink-0 transition-colors hover:bg-[#2c2c37]')}
        aria-label={label}
        data-testid={testId}
      >
        {active && selected?.icon ? selected.icon : icon}
        <span className={cn('whitespace-nowrap', active && 'text-white')}>
          {active && selected ? selected.label : label}
        </span>
        <ChevronDownIcon className="transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12} className={MENU}>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as T | 'all')}
            className="flex flex-col gap-[6px]"
          >
            {options.map((o) => (
              <DropdownMenu.RadioItem key={o.value} value={o.value} className={MENU_ITEM}>
                {o.icon}
                {o.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);

/**
 * Кейсы главной с фильтрами (макет): плашка #181821, скругление 36, внутри 24; слева категория,
 * поиск (справа 36) и цена «от–до» (два поля по 191 без зазора, между ними — только линия),
 * справа уровень адреналина и ластик (сброс, без контура). Между фреймами 24.
 * Ниже — категории: заголовок DemiBold 36 по центру, в 48px от фильтров и от сетки карточек.
 */
export function CaseBrowser({
  game,
  categories: allCategories,
}: {
  game: string;
  categories: CaseCategoryDto[];
}) {
  // Бесплатные (бонусные) кейсы на витрине не показываются — их открывают из баннера и бонусов.
  const categories = useMemo(
    () =>
      allCategories
        .map((c) => ({ ...c, cases: c.cases.filter((k) => k.kind !== 'free') }))
        .filter((c) => c.cases.length > 0),
    [allCategories],
  );
  const t = useTranslations('home.filters');
  const all = useMemo(() => categories.flatMap((c) => c.cases), [categories]);
  const maxPrice = useMemo(() => all.reduce((m, c) => Math.max(m, c.price), 0), [all]);

  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState(String(maxPrice));
  const [level, setLevel] = useState<AdrenalineLevel | 'all'>('all');

  const reset = () => {
    setCategory('all');
    setQuery('');
    setMin('0');
    setMax(String(maxPrice));
    setLevel('all');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ru');
    const lo = min === '' ? 0 : Number(min);
    const hi = max === '' ? Number.POSITIVE_INFINITY : Number(max);
    return categories
      .filter((c) => category === 'all' || c.code === category)
      .map((c) => ({
        ...c,
        cases: c.cases.filter(
          (k) =>
            (!q || k.name.toLocaleLowerCase('ru').includes(q)) &&
            k.price >= Math.min(lo, hi) &&
            k.price <= Math.max(lo, hi) &&
            (level === 'all' || k.adrenaline === level),
        ),
      }))
      .filter((c) => c.cases.length > 0);
  }, [categories, category, query, min, max, level]);

  const levelOptions = [
    { value: 'all' as const, label: t('anyAdrenaline'), icon: <AdrenalineIcon /> },
    ...ADRENALINE_LEVELS.map((l) => {
      const Icon = LEVEL_ICONS[l];
      return { value: l, label: t(`levels.${l}`), icon: <Icon /> };
    }),
  ];

  return (
    <div className="flex flex-col gap-6 md:gap-12">
      <section
        className="flex flex-wrap items-center justify-between gap-6 rounded-[24px] bg-surface-1 p-3 max-md:[zoom:0.72] md:rounded-[36px] md:p-6"
        aria-label={t('label')}
        data-testid="case-filters"
      >
        <div className="flex flex-wrap items-center gap-6">
          <Select
            label={t('category')}
            value={category}
            options={[
              { value: 'all', label: t('allCategories') },
              ...categories.map((c) => ({ value: c.code, label: c.name })),
            ]}
            onChange={setCategory}
            testId="filter-category"
          />
          <label className={cn(FRAME, 'pr-9')}>
            <SearchIcon className="shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="w-[227px] min-w-0 bg-transparent text-white outline-none placeholder:text-white/20 [&::-webkit-search-cancel-button]:hidden"
              data-testid="filter-search"
            />
          </label>
          <div className="flex rounded-[12px] bg-[#26262f] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]">
            {(
              [
                [min, setMin, t('priceFrom'), '0', 'filter-price-min'],
                [max, setMax, t('priceTo'), String(maxPrice), 'filter-price-max'],
              ] as const
            ).map(([value, set, label, placeholder, testId], i) => (
              <label
                key={testId}
                className={cn(
                  'flex h-[72px] w-[191px] items-center gap-6 px-6 text-[24px] font-medium',
                  i === 1 && 'shadow-[inset_1px_0_0_rgb(255_255_255/0.2)]',
                )}
              >
                <GemIcon className="shrink-0 text-lime" />
                <input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => set(digits(e.target.value))}
                  placeholder={placeholder}
                  aria-label={label}
                  className="w-full min-w-0 bg-transparent text-white outline-none placeholder:text-white/20"
                  data-testid={testId}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Select
            label={t('adrenaline')}
            value={level}
            options={levelOptions}
            onChange={setLevel}
            icon={<AdrenalineIcon />}
            testId="filter-adrenaline"
          />
          <button
            type="button"
            onClick={reset}
            className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[12px] bg-[#26262f] text-white/20 transition-colors hover:text-white/50"
            aria-label={t('reset')}
            title={t('reset')}
            data-testid="filter-reset"
          >
            <ClearIcon />
          </button>
        </div>
      </section>

      {filtered.length ? (
        filtered.map((cat) => (
          <section
            key={cat.code}
            className="flex flex-col gap-6 md:gap-12"
            aria-labelledby={`case-cat-${cat.code}`}
            data-testid={`case-category-${cat.code}`}
          >
            <h2
              id={`case-cat-${cat.code}`}
              className="text-center text-[24px] font-semibold md:text-[36px]"
            >
              {cat.name}
            </h2>
            <div className="case-grid">
              {cat.cases.map((c) => (
                <CaseTile key={c.id} game={game} c={c} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState icon={<Package size={40} />} text={t('empty')} />
      )}
    </div>
  );
}
