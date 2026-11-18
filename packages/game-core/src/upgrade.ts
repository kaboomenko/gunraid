/**
 * Апгрейд: шанс = ставка / цена цели × (1 − комиссия), не выше максимального.
 * Шанс и бросок хранятся целыми в миллионных долях (100 % = 1 000 000).
 */
export const CHANCE_SCALE = 1_000_000;

export interface UpgradeParams {
  commission: number;
  maxChance: number;
  minChance: number;
}

export function upgradeChance(stake: number, targetPrice: number, p: UpgradeParams): number {
  if (stake <= 0 || targetPrice <= 0) return 0;
  return Math.min(p.maxChance, (stake / targetPrice) * (1 - p.commission));
}

export function chanceToScaled(chance: number): number {
  return Math.max(0, Math.min(CHANCE_SCALE, Math.floor(chance * CHANCE_SCALE)));
}

export function rollToScaled(roll: number): number {
  return Math.floor(roll * CHANCE_SCALE);
}

/** Победа, если бросок (в миллионных) меньше шанса (в миллионных). */
export function upgradeWins(rollScaled: number, chanceScaled: number): boolean {
  return rollScaled < chanceScaled;
}

/** Цена цели под множитель ставки (кнопки x1.5, x2, x5, x10). */
export function targetPriceForMultiplier(stake: number, multiplier: number): number {
  return Math.round(stake * multiplier);
}
