import { rollFloat, sha256Hex } from './fair.js';
import { ticketFromFloat } from './odds.js';

/** Покупка в раунде груза: места «от–до» включительно и client seed покупателя на момент покупки. */
export interface CargoSeatRange {
  seatFrom: number;
  seatTo: number;
  clientSeed: string;
}

/**
 * Строка, от которой берётся SHA-256 (D4): JSON без пробелов `[[от,до,"seed"],…]` по порядку мест, UTF-8.
 * Пример: `[[1,3,"aaaaaaaa"],[4,4,"bbbbbbbb"]]`. JSON, а не склейка через «:», — разные списки не дают одну строку.
 */
export function cargoClientSeedPreimage(purchases: readonly CargoSeatRange[]): string {
  return JSON.stringify(purchases.map((p) => [p.seatFrom, p.seatTo, p.clientSeed]));
}

/** Client seed раунда: SHA-256 (hex) от cargoClientSeedPreimage. */
export function cargoClientSeed(purchases: readonly CargoSeatRange[]): string {
  return sha256Hex(cargoClientSeedPreimage(purchases));
}

/** Число проданных мест; покупки обязаны идти подряд с места 1 без пропусков и наложений. */
export function cargoSeatsSold(
  purchases: readonly Pick<CargoSeatRange, 'seatFrom' | 'seatTo'>[],
): number {
  let next = 1;
  for (const p of purchases) {
    if (p.seatFrom !== next || p.seatTo < p.seatFrom) {
      throw new RangeError(`seats are not contiguous at ${next}`);
    }
    next = p.seatTo + 1;
  }
  return next - 1;
}

/** Выигравшее место 1…sold: float = HMAC(serverSeed, "{clientSeed}:0:0"), место = floor(float × sold) + 1. */
export function cargoWinningSeat(
  serverSeed: string,
  cargoClientSeedHex: string,
  sold: number,
): number {
  if (!Number.isSafeInteger(sold) || sold < 1) throw new RangeError('no seats sold');
  return ticketFromFloat(rollFloat(serverSeed, cargoClientSeedHex, 0), sold) + 1;
}

/** Покупка, которой принадлежит место (диапазоны отсортированы по seatFrom; бинарный поиск). */
export function cargoSeatOwner<T extends { seatFrom: number; seatTo: number }>(
  purchases: readonly T[],
  seat: number,
): T {
  let lo = 0;
  let hi = purchases.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = purchases[mid]!;
    if (seat < p.seatFrom) hi = mid - 1;
    else if (seat > p.seatTo) lo = mid + 1;
    else return p;
  }
  throw new RangeError(`seat ${seat} has no owner`);
}
