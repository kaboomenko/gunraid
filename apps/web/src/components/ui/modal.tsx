'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const WIDTHS = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTHS;
  /** Нельзя закрыть кликом по фону / Esc (например, подтверждение 18+). */
  persistent?: boolean;
  hideTitle?: boolean;
  className?: string;
}

/** Модалка: на телефоне выезжает снизу (bottom sheet), на компьютере — по центру. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  persistent,
  hideTitle,
  className,
}: ModalProps) {
  const t = useTranslations('common');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="gr-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={description ? undefined : undefined}
          onPointerDownOutside={persistent ? (e) => e.preventDefault() : undefined}
          onEscapeKeyDown={persistent ? (e) => e.preventDefault() : undefined}
          className={cn(
            'gr-sheet fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-y-auto outline-none',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2',
            WIDTHS[size],
          )}
        >
          <div
            className={cn(
              'cut cut-lg pb-safe [--cut-bg:var(--color-surface-1)] [--cut-border:var(--color-line-strong)]',
              className,
            )}
          >
            <div className="mx-auto mt-2 h-1 w-10 bg-surface-3 sm:hidden" aria-hidden="true" />
            <div className="flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6">
              <div className="min-w-0">
                <Dialog.Title
                  className={cn(
                    'font-display text-lg font-extrabold uppercase tracking-wide sm:text-xl',
                    hideTitle && 'sr-only',
                  )}
                >
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              {!persistent && (
                <Dialog.Close
                  className="clip-cut -mr-1 grid h-9 w-9 shrink-0 place-items-center bg-surface-3 text-muted transition hover:text-text [--cut:6px]"
                  aria-label={t('close')}
                >
                  <X size={18} />
                </Dialog.Close>
              )}
            </div>
            <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
            {footer && <div className="border-t border-line px-5 py-4 sm:px-6">{footer}</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
