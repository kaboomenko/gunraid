import { z } from 'zod';
import type { ItemDto } from './catalog.js';

/**
 * Ивентовые грузы: розыгрыш одного супер-приза среди купленных мест. Шаблон — вид груза в игре,
 * раунд — текущий розыгрыш шаблона (open → landed / expired / cancelled).
 */
export const CARGO_ROUND_STATUSES = ['open', 'landed', 'expired', 'cancelled'] as const;
export type CargoRoundStatus = (typeof CARGO_ROUND_STATUSES)[number];
/** Как закрылся раунд: распродан, вышел таймер, продано меньше минимума (D36). */
export const CARGO_LAND_REASONS = ['sold_out', 'deadline', 'min_seats'] as const;
export type CargoLandReason = (typeof CARGO_LAND_REASONS)[number];
/** Почему игрок не может купить места сейчас. */
export const CARGO_BLOCK_REASONS = [
  'LOGIN',
  'ADULT',
  'LEVEL',
  'NO_DEPOSIT',
  'LIMIT',
  'SOLD_OUT',
  'CLOSED',
  'UNAVAILABLE',
] as const;
export type CargoBlockReason = (typeof CARGO_BLOCK_REASONS)[number];
/** Почему у активного груза нет открытого раунда: приз недоступен (ждёт админа) или раунд вот-вот откроется. */
export type CargoNoRoundReason = 'PRIZE_UNAVAILABLE' | 'STARTING';
/** Потолок мест в раунде (D38): приземление и доказательство читают все покупки разом. */
export const CARGO_MAX_SEATS = 10_000;
/** Client seed покупки (D4, D5): только эти символы — строка для SHA-256 не требует экранирования. */
export const CARGO_SEED_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Через сколько после приземления результат попадает в ленту и уведомления (анимация на странице). */
export const CARGO_REVEAL_DELAY_MS = 3_000;
/** Картинки видов груза (apps/web/public/media/cargo): 1000 px и уменьшенные 500 / 256 (§W.1). */
export const CARGO_IMAGE_KINDS = ['light', 'black', 'free', 'signal', 'special'] as const;
export type CargoImageKind = (typeof CARGO_IMAGE_KINDS)[number];
export const cargoImageUrl = (kind: CargoImageKind) => `/media/cargo/${kind}.webp`;
const CARGO_IMAGE_RE = /^\/media\/cargo\/([a-z]+)\.webp$/;
/**
 * Уменьшенная копия стандартной картинки (`/media/cargo/{kind}.webp` → `{kind}-500.webp`); свой путь — как есть.
 * Стандартная — только из CARGO_IMAGE_KINDS: у других файлов в /media/cargo уменьшенных копий нет.
 */
export function cargoImageVariant(url: string, size: 256 | 500 | 1000): string {
  const kind = CARGO_IMAGE_RE.exec(url)?.[1];
  const standard = kind !== undefined && (CARGO_IMAGE_KINDS as readonly string[]).includes(kind);
  return standard && size !== 1000 ? `/media/cargo/${kind}-${size}.webp` : url;
}
export const CARGO_SLUG_RE = /^[a-z0-9-]{2,80}$/;

export interface CargoWinnerDto {
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
}

export interface CargoRoundDto {
  id: string;
  number: number;
  status: CargoRoundStatus;
  seatsTotal: number;
  seatsSold: number;
  seatPrice: number;
  perUserLimit: number | null;
  minLevel: number | null;
  depositWithinDays: number | null;
  /** Минимум продаж для приземления по таймеру (D36); null — без минимума. */
  minSeatsToLand: number | null;
  prize: ItemDto;
  serverSeedHash: string;
  startedAt: string;
  endsAt: string;
}

/** Покупка игрока в раунде: места и его client seed (видит только он сам). */
export interface CargoMyPurchaseDto {
  seatFrom: number;
  seatTo: number;
  clientSeed: string;
}

export interface CargoAvailabilityDto {
  canBuy: boolean;
  reason: CargoBlockReason | null;
  /** Мест у игрока в этом раунде и его покупки (при любой reason, если игрок вошёл). */
  mySeats: number;
  myPurchases: CargoMyPurchaseDto[];
  /** Сколько мест можно взять за раз (свободные и остаток лимита; для гостя — как будто вошёл); 0 — нельзя. */
  maxBuy: number;
}

export interface CargoCardDto {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  isFree: boolean;
  roundId: string;
  seatsTotal: number;
  seatsSold: number;
  seatPrice: number;
  endsAt: string;
  prize: ItemDto;
}

export interface CargoListDto {
  items: CargoCardDto[];
  serverTime: string;
}

export interface CargoResultDto {
  roundId: string;
  templateId: string;
  number: number;
  status: Exclude<CargoRoundStatus, 'open'>;
  /** 'min_seats' — закрыт по минимуму продаж (D36); у cancelled — null. */
  landReason: CargoLandReason | null;
  seatsSold: number;
  seatsTotal: number;
  minSeatsToLand: number | null;
  winningSeat: number | null;
  winner: CargoWinnerDto | null;
  /** Были возвраты гемов (отмена или минимум продаж с платными местами). */
  refunded: boolean;
  prize: ItemDto;
  finishedAt: string;
}

export interface CargoDetailDto {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  isFree: boolean;
  /** Текущий открытый раунд; null — нового раунда нет (см. noRound). */
  round: CargoRoundDto | null;
  /** Только при round === null: приз недоступен (пауза до действий админа) или раунд открывается. */
  noRound: CargoNoRoundReason | null;
  availability: CargoAvailabilityDto;
  /** Последний завершённый раунд (показ результата, если сокет пропустил событие). */
  lastResult: CargoResultDto | null;
  serverTime: string;
}

export const cargoBuySchema = z
  .object({
    roundId: z.string().uuid(),
    count: z.number().int().min(1).max(CARGO_MAX_SEATS),
    /** Обязателен (D5): сервер не подставляет свой. */
    clientSeed: z.string().regex(CARGO_SEED_RE),
  })
  .strict();
export type CargoBuyBody = z.infer<typeof cargoBuySchema>;

export interface CargoBuyResultDto {
  purchaseId: string;
  templateId: string;
  slug: string;
  roundId: string;
  seatFrom: number;
  seatTo: number;
  count: number;
  paid: number;
  /** Эхо присланного client seed и commit раунда (D5): покупатель может сверить их с доказательством. */
  clientSeed: string;
  serverSeedHash: string;
  balance: number;
  /** Раунд после покупки (status 'landed', если эта покупка заняла последнее место). */
  round: CargoRoundDto;
  availability: CargoAvailabilityDto;
  result: CargoResultDto | null;
  next: CargoRoundDto | null;
}

/** Строка сверки грузов (D39): reconcileCargo в API, ручка сверки админки (этап A). */
export interface CargoMismatchDto {
  check: 'purchase_ledger' | 'entry_orphan' | 'refund_sum' | 'refunded_at' | 'seats';
  roundId: string | null;
  userId: string | null;
  ref: string | null;
}

/** cargo:seats — изменилось число проданных мест. */
export interface CargoSeatsEventDto {
  game: string;
  templateId: string;
  roundId: string;
  seatsSold: number;
  seatsTotal: number;
}
/** cargo:result — раунд завершился (приземлился, закрыт без участников, отменён). */
export interface CargoResultEventDto {
  game: string;
  slug: string;
  result: CargoResultDto;
}
/** cargo:round — начался новый раунд шаблона. */
export interface CargoRoundEventDto {
  game: string;
  templateId: string;
  slug: string;
  round: CargoRoundDto;
}

export interface CargoProofDto {
  type: 'cargo';
  id: string;
  cargoName: string;
  number: number;
  status: CargoRoundStatus;
  revealed: boolean;
  serverSeed: string | null;
  serverSeedHash: string;
  /** Client seed раунда (хэш списка покупок) — после приземления, отмены или закрытия по минимуму с продажами. */
  clientSeed: string | null;
  /** По порядку мест; mine — покупка того, кто смотрит (ручка с @OptionalAuth). */
  purchases: Array<{ seatFrom: number; seatTo: number; clientSeed: string; mine: boolean }>;
  seatsSold: number;
  seatsTotal: number;
  minSeatsToLand: number | null;
  landReason: CargoLandReason | null;
  winningSeat: number | null;
  /** Отменённый / закрытый по минимуму раунд с продажами: место, которое выиграло бы (D33). */
  voidSeat: number | null;
  winner: { shortId: number; nickname: string } | null;
  prize: { itemId: string; name: string; price: number; imageUrl: string | null };
  startedAt: string;
  finishedAt: string | null;
}
