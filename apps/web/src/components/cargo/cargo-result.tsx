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
 * Телефон (< 768) — по шкале телефона, тем же механизмом, что окно результата кейса (`Modal phoneScale`,
 * `Button size="phone"`): поля 12, заголовок DemiBold 16, карточка содержимого кейса 108×72 (skin-card--m),
 * колонка через 12, блок победителя через 6 (аватар 24, ник DemiBold 12), тексты Medium 12, кнопка 36.
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
      phoneScale
      returnFocusRef={returnFocusRef}
    >
      {r && (
        <div
          className="flex flex-col items-center gap-5 text-center max-md:gap-3"
          data-testid="cargo-result"
        >
          <SkinCard item={r.prize} className="skin-card--m w-[286px] max-w-full max-md:w-[108px]" />
          {r.status === 'landed' && r.winner ? (
            <div className="flex flex-col items-center gap-3 max-md:gap-[6px]">
              {/* Ник одним словом шире окна (до 24 широких букв) переносится, а не раздвигает окно. */}
              <Link
                href={`/${game}/u/${r.winner.shortId}`}
                className="flex max-w-full items-center gap-3 text-lg font-semibold hover:text-accent max-md:gap-[6px] max-md:text-[12px] max-md:hover:text-lime"
                data-testid="cargo-result-winner"
              >
                {/* Телефон: аватар 24, буквы — 12, как у sm. */}
                <Avatar
                  src={r.winner.avatarUrl}
                  name={r.winner.nickname}
                  size="sm"
                  className="max-md:size-6"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {t('winner', { nickname: r.winner.nickname })}
                </span>
              </Link>
              {r.winningSeat !== null && (
                <p
                  className="text-muted max-md:text-[12px] max-md:font-medium"
                  data-testid="cargo-result-seat"
                >
                  {t('seat', { seat: r.winningSeat, sold: r.seatsSold })}
                </p>
              )}
              {/* Телефон: без одиночного слова во второй строке (balance), «Это вы!» — лайм сайта #B7FF00. */}
              <p
                className={
                  won
                    ? 'font-semibold text-accent max-md:text-balance max-md:text-[12px] max-md:text-lime'
                    : 'text-muted max-md:text-balance max-md:text-[12px] max-md:font-medium'
                }
              >
                {won ? t('youWon') : t('youLost')}
              </p>
            </div>
          ) : (
            <p className="text-muted max-md:text-balance max-md:text-[12px] max-md:font-medium">
              {r.status === 'cancelled'
                ? // Возврата не было — груз бесплатный (окно видит участник: места у него были).
                  t(r.refunded ? 'cancelledText' : 'cancelledNoRefundText')
                : r.landReason === 'min_seats'
                  ? r.refunded
                    ? t('expiredMinText', { min: r.minSeatsToLand ?? 0 })
                    : t('expiredMinFreeText', { min: r.minSeatsToLand ?? 0 })
                  : t('expiredText')}
            </p>
          )}
          {/*
            Телефон: Medium 12, иконка 12, через 12 — текст; область нажатия 28 (по 8 сверху и снизу), как у «Проверить
            результат» в окне кейса. От 768 — прежние 8.
          */}
          <Link
            href={`/provably-fair?cargo=${r.roundId}`}
            className="flex items-center justify-center gap-2 text-xs text-dim hover:text-text max-md:-my-2 max-md:gap-3 max-md:py-2 max-md:font-medium"
            data-testid="cargo-result-verify"
          >
            <ShieldCheck size={14} aria-hidden="true" className="max-md:size-3" /> {t('verify')}
          </Link>
          {/* Телефон: лайм сайта #B7FF00, как у кнопки покупки и у «Открыть ещё» в окне кейса (primary — #C6FF00). */}
          <Button
            size="phone"
            className="w-full max-md:bg-lime max-md:hover:bg-lime max-md:hover:brightness-110"
            onClick={onClose}
            data-testid="cargo-result-close"
          >
            {t('next')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
