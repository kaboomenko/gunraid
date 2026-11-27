'use client';

import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

let seq = 0;
const useToasts = create<{
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  remove: (id: number) => void;
}>()((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 4200);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  success: (text: string) => useToasts.getState().push({ tone: 'success', text }),
  error: (text: string) => useToasts.getState().push({ tone: 'error', text }),
  info: (text: string) => useToasts.getState().push({ tone: 'info', text }),
};

const ICONS = { success: CheckCircle2, error: TriangleAlert, info: Info } as const;

export function Toaster() {
  const items = useToasts((s) => s.items);
  const remove = useToasts((s) => s.remove);
  return (
    // Телефон (< 768): сверху, в 8 от безопасной зоны (шапка телефона не липкая, снизу — нижнее меню);
    // от 768 — снизу справа. gr-toaster — при открытой шторке «Меню» тосты ниже её строки аккаунта (globals.css).
    <div
      className="gr-toaster pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-5 md:right-5 md:top-auto md:items-end"
      aria-live="polite"
    >
      {items.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              'gr-toast cut pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 text-sm [--cut-bg:var(--color-surface-2)]',
              t.tone === 'success' && '[--cut-border:rgb(198_255_0/0.5)]',
              t.tone === 'error' && '[--cut-border:rgb(255_61_94/0.6)]',
            )}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon
              size={18}
              className={cn(
                'mt-0.5 shrink-0',
                t.tone === 'success' && 'text-accent',
                t.tone === 'error' && 'text-danger',
                t.tone === 'info' && 'text-info',
              )}
            />
            <span className="flex-1">{t.text}</span>
            <button
              className="text-dim hover:text-text"
              onClick={() => remove(t.id)}
              aria-label="×"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
