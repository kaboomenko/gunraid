import { caseRtp, fitOddsToRtp } from '@gunraid/game-core';
import { ADRENALINE_CV_THRESHOLDS, ADRENALINE_LEVELS, type AdrenalineLevel } from '@gunraid/shared';

/** Предмет-кандидат: цена в гемах и порядковый номер редкости (больше — реже). */
export interface PoolItem {
  id: string;
  price: number;
  rarityRank: number;
}

export interface PlannedContents {
  entries: Array<{ itemId: string; odds: number; price: number }>;
  rtp: number;
  /** Разброс цен содержимого относительно цены кейса (как в caseAdrenaline). */
  cv: number;
  level: AdrenalineLevel;
}

/** Середина диапазона каждого уровня — к ней тянется подбор. */
const LEVEL_CENTER: Record<AdrenalineLevel, number> = {
  low: 0.9,
  normal: 1.85,
  high: 2.5,
  extreme: 3.4,
};
const MIN_FACTORS = [0.02, 0.04, 0.07, 0.12, 0.2, 0.3, 0.45, 0.6, 0.75, 0.85];
const MAX_FACTORS = [
  1.3, 1.6, 2, 2.5, 3, 4, 5, 6.5, 8, 10, 13, 16, 20, 25, 32, 40, 50, 65, 80, 100, 130, 160, 200,
  260, 330, 420, 550, 700, 900, 1200,
];

/** Равномерная выборка count элементов из упорядоченного списка (как в демо-сидах). */
export function spread<T>(list: T[], count: number): T[] {
  if (list.length <= count) return list;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const v = list[Math.round((i * (list.length - 1)) / (count - 1))];
    if (v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
}

function stats(prices: number[], odds: number[], casePrice: number) {
  const total = odds.reduce((a, b) => a + b, 0);
  let ev = 0;
  for (let i = 0; i < prices.length; i++)
    ev += ((odds[i] as number) / total) * (prices[i] as number);
  let variance = 0;
  for (let i = 0; i < prices.length; i++) {
    variance += ((odds[i] as number) / total) * ((prices[i] as number) - ev) ** 2;
  }
  const cv = Math.sqrt(variance) / casePrice;
  const [a, b, c] = ADRENALINE_CV_THRESHOLDS;
  const level: AdrenalineLevel = cv < a ? 'low' : cv < b ? 'normal' : cv < c ? 'high' : 'extreme';
  return { cv, level, total };
}

/**
 * Состав платного кейса под целевой уровень адреналина: перебирает диапазоны цен предметов
 * (от доли до кратного цены кейса), шансы подгоняет под RTP и выбирает вариант, у которого
 * разброс ближе всего к середине нужного уровня. Если уровень недостижим на этом каталоге
 * (например, дорогой кейс без ещё более дорогих предметов), берёт самый близкий.
 * preferRarity — предпочитать предметы не ниже этой редкости (сейфы по редкостям).
 */
export function planContents(
  pool: PoolItem[],
  casePrice: number,
  targetRtp: number,
  level: AdrenalineLevel,
  count: number,
  preferRarity?: number,
): PlannedContents | null {
  const sorted = [...pool].sort((x, y) => x.price - y.price || x.id.localeCompare(y.id));
  const target = casePrice * targetRtp;
  const want = ADRENALINE_LEVELS.indexOf(level);
  let best: { score: number; plan: PlannedContents } | null = null;

  for (const maxF of MAX_FACTORS) {
    for (const minF of MIN_FACTORS) {
      const sub = sorted.filter((p) => p.price >= casePrice * minF && p.price <= casePrice * maxF);
      if (sub.length < 5) continue;
      const chosen = spread(sub, count);
      const prices = chosen.map((c) => c.price);
      if (!(Math.min(...prices) < target && Math.max(...prices) > target)) continue;
      const odds = fitOddsToRtp(prices, casePrice, targetRtp);
      const entries = chosen.map((c, i) => ({
        itemId: c.id,
        odds: odds[i] as number,
        price: c.price,
      }));
      const rtp = caseRtp(entries, casePrice);
      if (rtp === null || Math.abs(rtp - targetRtp) > 0.01) continue;
      const s = stats(prices, odds, casePrice);
      const got = ADRENALINE_LEVELS.indexOf(s.level);
      let score =
        got === want
          ? Math.abs(s.cv - LEVEL_CENTER[level])
          : 10 + Math.abs(s.cv - LEVEL_CENTER[level]);
      if (preferRarity !== undefined) {
        // Доля вероятности на предметах ниже нужной редкости — штраф (сейф должен быть «про» неё).
        const below = chosen.reduce(
          (acc, c, i) => acc + (c.rarityRank < preferRarity ? (odds[i] as number) / s.total : 0),
          0,
        );
        score += below * 1.5;
      }
      if (!best || score < best.score - 1e-9) {
        best = { score, plan: { entries, rtp, cv: s.cv, level: s.level } };
      }
    }
  }
  return best?.plan ?? null;
}
