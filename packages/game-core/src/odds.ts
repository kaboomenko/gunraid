/**
 * Шансы кейса — целые числа в единицах 0,00001 % (100 % = 10 000 000).
 * Целочисленные шансы исключают ошибки округления при сумме и при выборе предмета.
 */
export const ODDS_TOTAL = 10_000_000;
export const ODDS_PER_PERCENT = 100_000;

export interface OddsEntry {
  itemId: string;
  odds: number;
}

export function oddsSum(entries: Array<{ odds: number }>): number {
  return entries.reduce((s, e) => s + e.odds, 0);
}

export function validateOdds(entries: Array<{ odds: number }>): { ok: boolean; sum: number } {
  const sum = oddsSum(entries);
  const ok =
    entries.length > 0 &&
    sum === ODDS_TOTAL &&
    entries.every((e) => Number.isSafeInteger(e.odds) && e.odds > 0);
  return { ok, sum };
}

export function ticketFromFloat(value: number, total = ODDS_TOTAL): number {
  if (!(value >= 0 && value < 1)) throw new RangeError('roll must be in [0, 1)');
  return Math.floor(value * total);
}

/** Предмет, в диапазон накопленных шансов которого попал билет. Порядок записей важен и фиксирован ревизией. */
export function pickByTicket<T extends { odds: number }>(entries: T[], ticket: number): T {
  let acc = 0;
  for (const e of entries) {
    acc += e.odds;
    if (ticket < acc) return e;
  }
  throw new RangeError(`ticket ${ticket} is out of range ${acc}`);
}

export function oddsToPercent(odds: number): string {
  const s = (odds / ODDS_PER_PERCENT).toFixed(5);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function percentToOdds(percent: string | number): number {
  return Math.round(Number(String(percent).replace(',', '.')) * ODDS_PER_PERCENT);
}

/** Ожидаемая стоимость открытия (гемы, дробная). */
export function expectedValue(entries: Array<{ odds: number; price: number }>): number {
  return entries.reduce((s, e) => s + (e.odds / ODDS_TOTAL) * e.price, 0);
}

/** RTP кейса = ожидаемая стоимость / цена кейса. Для бесплатного кейса — null. */
export function caseRtp(entries: Array<{ odds: number; price: number }>, casePrice: number): number | null {
  if (casePrice <= 0) return null;
  return expectedValue(entries) / casePrice;
}

/**
 * Подбор шансов под целевой RTP: веса ∝ 1/price^a, «a» ищется бинарным поиском.
 * Используется сидами и подсказкой в редакторе кейса. Результат — целые шансы с суммой ровно 100 %.
 */
export function fitOddsToRtp(prices: number[], casePrice: number, targetRtp: number): number[] {
  if (!prices.length) return [];
  const target = casePrice * targetRtp;
  const ev = (a: number) => {
    const w = prices.map((p) => 1 / Math.max(p, 1) ** a);
    const sw = w.reduce((x, y) => x + y, 0);
    return w.reduce((s, wi, i) => s + (wi / sw) * (prices[i] as number), 0);
  };
  let lo = -2;
  let hi = 6;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (ev(mid) > target) lo = mid;
    else hi = mid;
  }
  const a = (lo + hi) / 2;
  const weights = prices.map((p) => 1 / Math.max(p, 1) ** a);
  const sw = weights.reduce((x, y) => x + y, 0);
  const odds = weights.map((w) => Math.max(1, Math.round((w / sw) * ODDS_TOTAL)));
  const diff = ODDS_TOTAL - odds.reduce((x, y) => x + y, 0);
  const maxIdx = odds.indexOf(Math.max(...odds));
  odds[maxIdx] = (odds[maxIdx] as number) + diff;
  return odds;
}
