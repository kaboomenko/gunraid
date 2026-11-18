import type { WithdrawalStatus } from '@gunraid/db';

/**
 * Провайдер вывода. Сейчас две реализации:
 * - CS2 — ЗАГЛУШКА P2P-маркета: после одобрения «покупает» скин и ждёт событий обмена
 *   (в админке их можно сымитировать); позже — реальный маркет с отправкой на trade-ссылку.
 * - Standoff 2 — ручной поток: игрок выставляет лот на рынке, оператор подтверждает покупку.
 */
export interface WithdrawalProvider {
  readonly code: string;
  readonly game: string;
  /** Явная пометка заглушки — показывается в админке. */
  readonly isStub: boolean;
  /** Статус сразу после одобрения оператором. */
  readonly approvedStatus: WithdrawalStatus;
}

export const CS2_P2P_STUB: WithdrawalProvider = {
  code: 'cs2_p2p_stub',
  game: 'cs2',
  isStub: true,
  approvedStatus: 'purchasing',
};

export const SO2_MANUAL: WithdrawalProvider = {
  code: 'so2_manual',
  game: 'standoff2',
  isStub: false,
  approvedStatus: 'awaiting_listing',
};

export const WITHDRAWAL_PROVIDERS = [CS2_P2P_STUB, SO2_MANUAL];

export function providerForGame(game: string): WithdrawalProvider | null {
  return WITHDRAWAL_PROVIDERS.find((p) => p.game === game) ?? null;
}

/** Разрешённые переходы статусов. */
export const TRANSITIONS: Record<string, WithdrawalStatus[]> = {
  pending_review: ['purchasing', 'awaiting_listing', 'rejected', 'cancelled'],
  purchasing: ['trade_sent', 'failed', 'rejected'],
  trade_sent: ['trade_accepted', 'failed'],
  trade_accepted: ['completed', 'reversed'],
  awaiting_listing: ['listing_submitted', 'expired', 'rejected', 'cancelled'],
  listing_submitted: ['completed', 'rejected'],
};

/** Статусы, при которых предмет возвращается в инвентарь. */
export const RETURN_STATUSES: WithdrawalStatus[] = [
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'reversed',
];
