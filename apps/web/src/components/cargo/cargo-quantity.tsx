'use client';

import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type CSSProperties } from 'react';
import { clampCount } from '@/lib/cargo-page';

/**
 * Выбор количества мест «−  50  +» (плашка 160×48, срез правого нижнего угла, лайм 20 % + размытие
 * фона — вариант glass). Число можно ввести с клавиатуры: при вводе — черновик, по Enter или уходу из
 * поля он приводится к 1…max; стрелки вверх и вниз — ±1.
 */
export function CargoQuantity({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const t = useTranslations('cargo');
  /** Пока игрок вводит число — черновик (может быть пустым); null — показываем value. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const step = (delta: number) => onChange(clampCount(value + delta, max));
  const commit = () => {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(n)) onChange(clampCount(n, max));
  };
  const atMin = disabled || value <= 1;
  const atMax = disabled || value >= max;
  return (
    <div className="cargo-qty cargo-shape-br">
      {/*
        aria-disabled, а не disabled: кнопка на границе (1 или max) держит фокус — иначе после нажатия
        с клавиатуры фокус падает на <body> (правило дома, base layer globals.css). Границу проверяет
        сам обработчик.
      */}
      <button
        type="button"
        className="cargo-qty__step"
        aria-label={t('less')}
        aria-disabled={atMin || undefined}
        onClick={() => {
          if (!atMin) step(-1);
        }}
        data-testid="cargo-qty-minus"
      >
        <Minus size={24} strokeWidth={2} aria-hidden="true" />
      </button>
      <input
        className="cargo-qty__value"
        inputMode="numeric"
        aria-label={t('count')}
        value={shown}
        style={{ '--n': String(shown.length || 1) } as CSSProperties}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setDraft(null);
            if (e.key === 'ArrowUp' ? !atMax : !atMin) step(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
        disabled={disabled}
        data-testid="cargo-qty"
      />
      <button
        type="button"
        className="cargo-qty__step"
        aria-label={t('more')}
        aria-disabled={atMax || undefined}
        onClick={() => {
          if (!atMax) step(1);
        }}
        data-testid="cargo-qty-plus"
      >
        <Plus size={24} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
