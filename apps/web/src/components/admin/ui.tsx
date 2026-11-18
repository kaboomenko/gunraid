'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  title: ReactNode;
  className?: string;
  render: (row: T) => ReactNode;
}

/** Таблица админки: горизонтальная прокрутка на узких экранах. */
export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const t = useTranslations('admin.common');
  return (
    <div className="cut overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-dim">
            {columns.map((c) => (
              <th key={c.key} className={cn('px-3 py-2.5 font-semibold', c.className)}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                className={cn(
                  'border-b border-line/60 last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                )}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2.5 align-middle', c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-dim">
                {empty ?? t('empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useTranslations('admin.common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="text-xs text-dim">{t('total', { count: total })}</div>;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span>{t('total', { count: total })}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="clip-cut grid h-8 w-8 place-items-center bg-surface-3 disabled:opacity-40 [--cut:5px]"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('prev')}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular">{t('page', { page, pages })}</span>
        <button
          type="button"
          className="clip-cut grid h-8 w-8 place-items-center bg-surface-3 disabled:opacity-40 [--cut:5px]"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('next')}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={cn('space-y-1 p-4', accent && '[--cut-border:rgb(198_255_0/0.5)]')}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-sm',
        disabled && 'opacity-50',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      {label && <span className="text-muted">{label}</span>}
    </label>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'clip-cut h-10 min-w-0 bg-surface-2 px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent [--cut:6px]',
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'clip-cut w-full bg-surface-2 px-3 py-2 text-sm text-text outline-none placeholder:text-dim focus-visible:ring-2 focus-visible:ring-accent [--cut:6px]',
        className,
      )}
      {...props}
    />
  );
}

export function AdminSection({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold uppercase">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)} %`;
}
