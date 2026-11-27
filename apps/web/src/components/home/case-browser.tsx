'use client';

import { ADRENALINE_LEVELS, type AdrenalineLevel, type CaseCategoryDto } from '@gunraid/shared';
import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, Popover } from 'radix-ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from 'react';
import {
  AdrenalineExtremeIcon,
  AdrenalineHighIcon,
  AdrenalineIcon,
  AdrenalineLowIcon,
  AdrenalineNormalIcon,
  ChevronDownIcon,
  ClearIcon,
  FilterIcon,
  GemIcon,
  SearchIcon,
} from '@/components/icons/design-icons';
import { EmptyState } from '@/components/ui/empty-state';
import {
  digits,
  extraFiltersActive,
  filterCategories,
  showcaseCategories,
} from '@/lib/case-filters';
import { cn } from '@/lib/cn';
import { MD_UP } from '@/lib/media';
import { CaseTile } from './case-tile';

const LEVEL_ICONS: Record<AdrenalineLevel, ComponentType<{ size?: number; className?: string }>> = {
  low: AdrenalineLowIcon,
  normal: AdrenalineNormalIcon,
  high: AdrenalineHighIcon,
  extreme: AdrenalineExtremeIcon,
};

/**
 * Внутренний фрейм фильтров (макет): высота 72 (24 + иконка 24 + 24), скругление 12, #26262F,
 * контур белый 20% 1px внутрь, текст и иконки белые 20%, Medium 24, внутри отступ 24.
 * Телефон (< 768, макет 360): высота 36 (12 + иконка 12 + 12), скругление 6, Medium 12, внутри 12, иконка → текст 12.
 */
const FRAME =
  'flex h-[72px] items-center gap-6 rounded-[12px] bg-[#26262f] px-6 text-[24px] font-medium text-white/20 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)] max-md:h-9 max-md:gap-3 max-md:rounded-[6px] max-md:px-3 max-md:text-[12px]';

/** Иконка во фрейме: 24; на телефоне высотой 12, ширина по пропорциям (уровни 31×24 → 15.5, гем 16×24 → 8). */
const ICON = 'shrink-0 max-md:h-3 max-md:w-auto';

/**
 * Подпись кнопки-меню. Телефон: тянется (стрелка — у правого края), длинное название — с многоточием. Обрезка только
 * по горизонтали (overflow-x: clip): overflow: hidden при обрезке строк по прописным срезал бы «р», «у».
 */
const LABEL =
  'whitespace-nowrap max-md:min-w-0 max-md:flex-1 max-md:overflow-x-clip max-md:text-ellipsis max-md:text-left';

/**
 * Рамка поля в фокусе (телефон): контур белый вместо белого 20% — у самого поля outline нет. На ≥ 768 поля
 * не меняются (там фокус по-прежнему виден только кареткой).
 */
const FIELD_FOCUS = 'max-md:has-[:focus-visible]:shadow-[inset_0_0_0_1px_white]';

/**
 * Меню фильтра — того же вида, что меню выбора игры. Телефон (один вид всех выпадающих меню телефона): панель
 * со скруглением 12 (левый верхний 3), поля 6, между пунктами 3; пункт — высота 36, поля 12, скругление 6, Medium 12
 * (иконки — ICON), под пальцем и в фокусе — #3E3E50.
 */
const MENU =
  'gr-pop z-50 flex flex-col gap-[6px] rounded-[24px] rounded-tl-[6px] bg-surface-1 p-3 shadow-[0_18px_48px_rgb(0_0_0/0.55)] outline-none max-md:gap-[3px] max-md:rounded-[12px] max-md:rounded-tl-[3px] max-md:p-[6px]';
const MENU_ITEM =
  'flex cursor-pointer select-none items-center gap-3 whitespace-nowrap rounded-[12px] bg-[#26262f] px-4 py-3 text-[20px] font-medium text-white outline-none transition-colors data-[highlighted]:bg-[#3e3e50] max-md:h-9 max-md:rounded-[6px] max-md:px-3 max-md:py-0 max-md:text-[12px]';

function Select<T extends string>({
  label,
  shortLabel,
  value,
  options,
  onChange,
  icon,
  testId,
  className,
}: {
  label: string;
  /** Подпись на телефоне, если полная не помещается в строку фильтров; имя кнопки остаётся полным. */
  shortLabel?: string;
  value: T | 'all';
  options: Array<{ value: T | 'all'; label: string; icon?: ReactNode }>;
  onChange: (v: T | 'all') => void;
  icon?: ReactNode;
  testId: string;
  className?: string;
}) {
  const selected = options.find((o) => o.value === value);
  const active = value !== 'all';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(FRAME, 'group shrink-0 transition-colors hover:bg-[#2c2c37]', className)}
        // Имя — с выбранным значением: оно видно на кнопке вместо подписи (WCAG 2.5.3, голосовое управление).
        aria-label={active && selected ? `${label}: ${selected.label}` : label}
        data-testid={testId}
      >
        {active && selected?.icon ? selected.icon : icon}
        {/*
          Подпись — прямым текстом своего span (короткая и полная — соседние span, а не вложенные: вложенный строчный
          span с обрезкой по прописным сдвигал текст на 1 px).
        */}
        {active && selected ? (
          <span className={cn(LABEL, 'text-white')}>{selected.label}</span>
        ) : shortLabel ? (
          <>
            <span className={cn(LABEL, 'md:hidden')}>{shortLabel}</span>
            <span className={cn(LABEL, 'max-md:hidden')}>{label}</span>
          </>
        ) : (
          <span className={LABEL}>{label}</span>
        )}
        <ChevronDownIcon
          className={cn(
            ICON,
            'transition-transform duration-150 group-data-[state=open]:rotate-180',
          )}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12} className={MENU}>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as T | 'all')}
            className="flex flex-col gap-[6px] max-md:gap-[3px]"
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

/**
 * Поле фильтра. Телефон: шрифт 16, сжатый до 12 (scale 0.75 от левого края) — при шрифте меньше 16 iOS Safari
 * увеличивает страницу при фокусе. Поле шире обёртки на треть, отрицательное поле справа возвращает ширину —
 * видимая ширина равна обёртке, прокрутки нет. shortPlaceholder — подсказка телефона поверх пустого поля
 * (атрибут placeholder один на все ширины). На ≥ 768 обёртка — display: contents: поле — прямой ребёнок рамки, как раньше.
 */
function FilterInput({
  className,
  shortPlaceholder,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { shortPlaceholder?: string }) {
  return (
    <span className="relative flex min-w-0 flex-1 items-center md:contents">
      <input
        {...props}
        className={cn(
          'peer min-w-0 bg-transparent text-white outline-none placeholder:text-white/20',
          'max-md:-mr-[33.333%] max-md:w-[133.333%] max-md:shrink-0 max-md:origin-left max-md:scale-75 max-md:text-[16px]',
          shortPlaceholder && 'max-md:placeholder:text-transparent',
          className,
        )}
      />
      {shortPlaceholder ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 hidden -translate-y-1/2 text-white/20 max-md:block peer-[:not(:placeholder-shown)]:invisible"
        >
          {shortPlaceholder}
        </span>
      ) : null}
    </span>
  );
}

/** Цена «от–до»: две половины в общей рамке, между ними линия. Десктоп — по 191 (высота 72), телефон — пополам (36). */
function PriceRange({
  min,
  max,
  setMin,
  setMax,
  maxPrice,
  className,
}: {
  min: string;
  max: string;
  setMin: Dispatch<SetStateAction<string>>;
  setMax: Dispatch<SetStateAction<string>>;
  maxPrice: number;
  className?: string;
}) {
  const t = useTranslations('home.filters');
  return (
    <div
      className={cn(
        'flex rounded-[12px] bg-[#26262f] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)] max-md:rounded-[6px]',
        className,
      )}
    >
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
            'max-md:h-9 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:gap-3 max-md:px-3 max-md:text-[12px]',
            i === 1 && 'shadow-[inset_1px_0_0_rgb(255_255_255/0.2)]',
            // Контур фокуса — по своей половине, со скруглением рамки с внешней стороны.
            i === 0 ? 'max-md:rounded-l-[6px]' : 'max-md:rounded-r-[6px]',
            FIELD_FOCUS,
          )}
        >
          <GemIcon className={cn(ICON, 'text-lime')} />
          <FilterInput
            inputMode="numeric"
            value={value}
            onChange={(e) => set(digits(e.target.value))}
            placeholder={placeholder}
            aria-label={label}
            className="w-full"
            data-testid={testId}
          />
        </label>
      ))}
    </div>
  );
}

/** Ластик — сброс всех фильтров (и категории с поиском), без контура: 72×72 / иконка 24, на телефоне 36×36 / 12. */
function ResetButton({ onClick, ref }: { onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const t = useTranslations('home.filters');
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[12px] bg-[#26262f] text-white/20 transition-colors hover:text-white/50 max-md:size-9 max-md:rounded-[6px]"
      aria-label={t('reset')}
      title={t('reset')}
      data-testid="filter-reset"
    >
      <ClearIcon className="max-md:size-3" />
    </button>
  );
}

/**
 * Кейсы главной с фильтрами (макет): плашка #181821, скругление 36, внутри 24; слева категория,
 * поиск (справа 36) и цена «от–до» (два поля по 191 без зазора, между ними — только линия),
 * справа уровень адреналина и ластик (сброс, без контура). Между фреймами 24.
 * Ниже — категории: заголовок DemiBold 36 по центру. Отступы — как в макете на глаз: в Figma между
 * рамками 48, но рамки заголовка и карточек выше текста, поэтому видимый зазор до заголовка и после
 * него — 120px (на ширине от 1280).
 * Телефон (< 768, макет 360): плашка 60 (12 + 36 + 12), скругление 18, поля 12; в строке через 12 — «Категория»,
 * «Поиск» (справа 16, тянется, не уже 88) и кнопка расширенных фильтров 36×36 без контура (иконка 12); цена, уровень
 * и ластик — в панели под плашкой (Radix Popover, на ширину плашки, в 3 ниже). Плашка → 48 → заголовок DemiBold 16 →
 * 48 → карточки; между категориями 48. Зазоры видимые — текст обрезан по прописным. «Нет кейсов» — текст 12, иконка 24.
 */
export function CaseBrowser({
  game,
  categories: allCategories,
}: {
  game: string;
  categories: CaseCategoryDto[];
}) {
  // Бесплатные (бонусные) кейсы на витрине не показываются — их открывают из баннера и бонусов.
  const categories = useMemo(() => showcaseCategories(allCategories), [allCategories]);
  const t = useTranslations('home.filters');
  const all = useMemo(() => categories.flatMap((c) => c.cases), [categories]);
  const maxPrice = useMemo(() => all.reduce((m, c) => Math.max(m, c.price), 0), [all]);

  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState(String(maxPrice));
  const [level, setLevel] = useState<AdrenalineLevel | 'all'>('all');
  /** Панель «Расширенные фильтры» — только на телефоне. */
  const [moreOpen, setMoreOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  // Окно стало шире 768 (поворот) — панель телефона закрываем: от 768 цена и уровень стоят в строке фильтров.
  useEffect(() => {
    const mq = window.matchMedia(MD_UP);
    const close = () => {
      if (mq.matches) setMoreOpen(false);
    };
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  const reset = () => {
    setCategory('all');
    setQuery('');
    setMin('0');
    setMax(String(maxPrice));
    setLevel('all');
  };

  const filtered = useMemo(
    () => filterCategories(categories, { category, query, min, max, level }),
    [categories, category, query, min, max, level],
  );
  const extraActive = extraFiltersActive({ min, max, level }, maxPrice);

  const levelOptions = [
    { value: 'all' as const, label: t('anyAdrenaline'), icon: <AdrenalineIcon className={ICON} /> },
    ...ADRENALINE_LEVELS.map((l) => {
      const Icon = LEVEL_ICONS[l];
      return { value: l, label: t(`levels.${l}`), icon: <Icon className={ICON} /> };
    }),
  ];
  const levelSelect = (className?: string) => (
    <Select
      label={t('adrenaline')}
      value={level}
      options={levelOptions}
      onChange={setLevel}
      icon={<AdrenalineIcon className={ICON} />}
      testId="filter-adrenaline"
      className={className}
    />
  );
  const priceRange = (className?: string) => (
    <PriceRange
      min={min}
      max={max}
      setMin={setMin}
      setMax={setMax}
      maxPrice={maxPrice}
      className={className}
    />
  );

  return (
    <div className="flex flex-col gap-12 md:gap-20 xl:gap-[120px]">
      <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Popover.Anchor asChild>
          <section
            className="flex flex-wrap items-center justify-between gap-6 rounded-[18px] bg-surface-1 p-3 max-md:h-[60px] max-md:flex-nowrap max-md:justify-start max-md:gap-3 md:rounded-[36px] md:p-6"
            aria-label={t('label')}
            data-testid="case-filters"
          >
            <div className="flex flex-wrap items-center gap-6 max-md:min-w-0 max-md:flex-1 max-md:flex-nowrap max-md:gap-3">
              <Select
                label={t('category')}
                shortLabel={t('categoryShort')}
                value={category}
                options={[
                  { value: 'all', label: t('allCategories') },
                  ...categories.map((c) => ({ value: c.code, label: c.name })),
                ]}
                onChange={setCategory}
                testId="filter-category"
                className="max-md:min-w-0 max-md:shrink"
              />
              <label
                className={cn(
                  FRAME,
                  'pr-9 max-md:min-w-[88px] max-md:flex-1 max-md:pr-4',
                  FIELD_FOCUS,
                )}
              >
                <SearchIcon className={ICON} />
                <FilterInput
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('search')}
                  shortPlaceholder={t('searchShort')}
                  aria-label={t('search')}
                  className="w-[227px] [&::-webkit-search-cancel-button]:hidden"
                  data-testid="filter-search"
                />
              </label>
              {priceRange('max-md:hidden')}
            </div>
            <div className="flex flex-wrap items-center gap-6 max-md:hidden">
              {levelSelect()}
              <ResetButton onClick={reset} />
            </div>
            {/* Телефон: цена, уровень и ластик — в панели под плашкой; иконка белая, когда что-то из них задано. */}
            <Popover.Trigger
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-[6px] bg-[#26262f] text-white/20 transition-colors hover:text-white/50 md:hidden',
                (extraActive || moreOpen) && 'text-white hover:text-white',
              )}
              aria-label={extraActive ? t('moreActive') : t('more')}
              data-testid="filter-more"
            >
              <FilterIcon size={12} />
            </Popover.Trigger>
          </section>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            ref={panelRef}
            tabIndex={-1}
            side="bottom"
            align="end"
            sideOffset={3}
            collisionPadding={12}
            // Фокус — на панель, а не на поле цены: иначе на телефоне сразу выезжает клавиатура.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              panelRef.current?.focus();
            }}
            // Shift+Tab с самой панели — на ластик, как с первого поля. Radix замыкает Tab по кругу только с крайних
            // элементов: с панели фокус уходил на последний элемент страницы перед порталом, и панель закрывалась.
            onKeyDown={(e) => {
              if (e.key === 'Tab' && e.shiftKey && e.target === e.currentTarget) {
                e.preventDefault();
                resetRef.current?.focus();
              }
            }}
            aria-label={t('more')}
            className="gr-pop z-50 flex w-[var(--radix-popover-trigger-width)] flex-col gap-3 rounded-[18px] bg-surface-1 p-3 shadow-[0_9px_24px_rgb(0_0_0/0.55)] outline-none md:hidden"
            data-testid="filter-more-panel"
          >
            {priceRange('w-full')}
            <div className="flex gap-3">
              {levelSelect('min-w-0 flex-1')}
              <ResetButton ref={resetRef} onClick={reset} />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {filtered.length ? (
        filtered.map((cat) => (
          <section
            key={cat.code}
            className="flex flex-col gap-12 md:gap-20 xl:gap-[120px]"
            aria-labelledby={`case-cat-${cat.code}`}
            data-testid={`case-category-${cat.code}`}
          >
            <h2
              id={`case-cat-${cat.code}`}
              className="text-center text-[16px] font-semibold md:text-[36px]"
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
        <EmptyState
          icon={<Package size={40} className="max-md:size-6" />}
          text={t('empty')}
          className="max-md:[&_p]:text-[12px]"
        />
      )}
    </div>
  );
}
