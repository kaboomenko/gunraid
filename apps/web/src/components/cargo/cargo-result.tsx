'use client';

import type { CargoResultDto } from '@gunraid/shared';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { RefObject } from 'react';
import { SkinCard } from '@/components/items/skin-card';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Окно результата раунда — только участнику (D31): у кого были места в раунде или кто победил. Приз
 * (карточка без шанса); приземлился — победитель, выигравшее место и «это вы» / «не повезло»; закрыт
 * по минимуму продаж или отменён — что стало с гемами. Ссылка на проверку раунда; кнопка — к следующему.
 */
export function CargoResult({
  game,
  result,
  meShortId,
  open,
  onClose,
  returnFocusRef,
}: {
  game: string;
  result: CargoResultDto | null;
  meShortId: number | null;
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('cargo.result');
  const r = result;
  // Закрытый без победителя раунд окно видит только участник, т. е. мест купили меньше минимума — не
  // «без участников».
  const title = !r
    ? ''
    : r.status === 'landed'
      ? t('title')
      : r.status === 'cancelled'
        ? t('titleCancelled')
        : r.landReason === 'min_seats'
          ? t('titleMinSeats')
          : t('titleExpired');
  const won = Boolean(r?.winner && meShortId !== null && r.winner.shortId === meShortId);
  return (
    <Modal
      open={open && Boolean(r)}
      onOpenChange={(v) => !v && onClose()}
      title={title}
      size="md"
      returnFocusRef={returnFocusRef}
    >
      {r && (
        <div className="flex flex-col items-center gap-5 text-center" data-testid="cargo-result">
          <SkinCard item={r.prize} className="w-[286px] max-w-full" />
          {r.status === 'landed' && r.winner ? (
            <div className="flex flex-col items-center gap-3">
              <Link
                href={`/${game}/u/${r.winner.shortId}`}
                className="flex items-center gap-3 text-lg font-semibold hover:text-accent"
                data-testid="cargo-result-winner"
              >
                <Avatar src={r.winner.avatarUrl} name={r.winner.nickname} size="sm" />
                <span>{t('winner', { nickname: r.winner.nickname })}</span>
              </Link>
              {r.winningSeat !== null && (
                <p className="text-muted" data-testid="cargo-result-seat">
                  {t('seat', { seat: r.winningSeat, sold: r.seatsSold })}
                </p>
              )}
              <p className={won ? 'font-semibold text-accent' : 'text-muted'}>
                {won ? t('youWon') : t('youLost')}
              </p>
            </div>
          ) : (
            <p className="text-muted">
              {r.status === 'cancelled'
                ? t('cancelledText')
                : r.landReason === 'min_seats'
                  ? r.refunded
                    ? t('expiredMinText', { min: r.minSeatsToLand ?? 0 })
                    : t('expiredMinFreeText', { min: r.minSeatsToLand ?? 0 })
                  : t('expiredText')}
            </p>
          )}
          <Link
            href={`/provably-fair?cargo=${r.roundId}`}
            className="flex items-center justify-center gap-2 text-xs text-dim hover:text-text"
            data-testid="cargo-result-verify"
          >
            <ShieldCheck size={14} aria-hidden="true" /> {t('verify')}
          </Link>
          <Button className="w-full" onClick={onClose} data-testid="cargo-result-close">
            {t('next')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
