'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';
import { cn } from '@/lib/cn';
import { useReturnFocus } from '@/lib/return-focus';

const WIDTHS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const;

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
  /**
   * Куда вернуть фокус после закрытия, если элемента, с которого окно открыли, уже нет (или фокуса
   * не было). Обычно фокус возвращается туда, где был при открытии.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Окно по шкале телефона (16 / 12 / 8) — для окон итога: результат кейса, итог груза. Действует только
   * на телефоне (< 768, в том числе на 640–767, где окно уже по центру): поля 12, заголовок DemiBold 16
   * без капса, описание Medium 12, крестик 36×36 со скруглением 6 и иконкой 12, углы окна скруглены на 12
   * вместо среза (у шторки снизу — верхние). Кнопки такого окна — `<Button size="phone">`. От 768 окно
   * такое же, как без пропа; у окон без пропа поля, кегли и срез прежние на всех ширинах.
   */
  phoneScale?: boolean;
}

/**
 * Модалка: на телефоне выезжает снизу (bottom sheet, до 640 — с ручкой в 8 под верхней кромкой), на
 * компьютере — по центру. С `phoneScale` на телефоне — поля, кегли и скругления по шкале телефона.
 */
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
  returnFocusRef,
  phoneScale,
}: ModalProps) {
  const t = useTranslations('common');
  const focus = useReturnFocus(returnFocusRef);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="gr-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          // Нажатие по тосту (он над подложкой) — не «мимо окна»: закрывается тост, а не окно (как у шторки «Меню»).
          onPointerDownOutside={(e) => {
            const target = e.detail.originalEvent.target;
            if (persistent || (target instanceof Element && target.closest('.gr-toast')))
              e.preventDefault();
          }}
          onEscapeKeyDown={persistent ? (e) => e.preventDefault() : undefined}
          className={cn(
            'gr-sheet fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-y-auto outline-none',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2',
            WIDTHS[size],
          )}
        >
          {/*
            phoneScale: телефонные значения — без префикса (до 768), от 768 (`md:`) — те же, что у окна без
            пропа. `sm:` здесь не годится: на 640–767 он перекрыл бы телефонные поля.
          */}
          <div
            className={cn(
              'cut cut-lg pb-safe [--cut-bg:var(--color-surface-1)] [--cut-border:var(--color-line-strong)]',
              // flow-root — отступ ручки шторки (mt-2, ручка есть до 640) не схлопывается с рамкой .cut: иначе
              // рамка опускается на 8 и ручка ложится на её верхнюю кромку. Без phoneScale — только до 640.
              // phoneScale на телефоне: без среза, рамка .cut (псевдоэлементы) скруглена на 12 — у шторки снизу
              // верхние углы, с 640 (окно по центру) все.
              phoneScale
                ? 'max-md:flow-root max-md:[--cut:0px] max-md:before:rounded-t-[12px] max-md:after:rounded-t-[11px] sm:max-md:before:rounded-b-[12px] sm:max-md:after:rounded-b-[11px]'
                : 'max-sm:flow-root',
              className,
            )}
          >
            <div className="mx-auto mt-2 h-1 w-10 bg-surface-3 sm:hidden" aria-hidden="true" />
            <div
              className={
                phoneScale
                  ? 'flex items-center justify-between gap-3 px-3 pt-3 md:items-start md:gap-4 md:px-6 md:pt-6'
                  : 'flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6'
              }
            >
              <div className="min-w-0">
                <Dialog.Title
                  className={cn(
                    phoneScale
                      ? 'font-display text-[16px] font-semibold md:text-xl md:font-extrabold md:uppercase md:tracking-wide'
                      : 'font-display text-lg font-extrabold uppercase tracking-wide sm:text-xl',
                    hideTitle && 'sr-only',
                  )}
                >
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description asChild>
                    <div
                      className={
                        phoneScale
                          ? 'mt-[6px] text-[12px] font-medium text-muted md:mt-1 md:text-sm md:font-normal'
                          : 'mt-1 text-sm text-muted'
                      }
                    >
                      {description}
                    </div>
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              {/* phoneScale на телефоне — как «Закрыть» шторки меню: 36×36, скругление 6, #26262F, иконка 12
                  белая 60 %, наведение и фокус — #3E3E50. */}
              {!persistent && (
                <Dialog.Close
                  className={
                    phoneScale
                      ? 'clip-cut grid h-9 w-9 shrink-0 place-items-center bg-surface-3 text-muted transition hover:text-text [--cut:6px] max-md:rounded-[6px] max-md:bg-[#26262f] max-md:text-white/60 max-md:[clip-path:none] max-md:hover:bg-[#3e3e50] max-md:focus-visible:bg-[#3e3e50] md:-mr-1'
                      : 'clip-cut -mr-1 grid h-9 w-9 shrink-0 place-items-center bg-surface-3 text-muted transition hover:text-text [--cut:6px]'
                  }
                  aria-label={t('close')}
                >
                  <X size={18} className={phoneScale ? 'max-md:size-3' : undefined} />
                </Dialog.Close>
              )}
            </div>
            <div
              className={
                phoneScale ? 'p-3 md:px-6 md:pb-6 md:pt-4' : 'px-5 pb-5 pt-4 sm:px-6 sm:pb-6'
              }
            >
              {children}
            </div>
            {footer && (
              <div
                className={
                  phoneScale
                    ? 'border-t border-line p-3 md:px-6 md:py-4'
                    : 'border-t border-line px-5 py-4 sm:px-6'
                }
              >
                {footer}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
