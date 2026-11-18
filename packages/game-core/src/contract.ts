/**
 * Контракт: множитель k ∈ [kMin, kMax] распределён со смещением к низу:
 * k = kMin + (kMax − kMin) · u^γ, где u — бросок provably fair в [0, 1).
 * E[k] = kMin + (kMax − kMin) / (γ + 1); γ подбирается так, чтобы E[k] = 1 − комиссия.
 */
export interface ContractParams {
  commission: number;
  coefMin: number;
  coefMax: number;
}

export function contractGamma(p: ContractParams): number {
  const target = 1 - p.commission;
  if (!(target > p.coefMin && target < p.coefMax)) {
    throw new RangeError('expected return must be inside (coefMin, coefMax)');
  }
  return (p.coefMax - p.coefMin) / (target - p.coefMin) - 1;
}

export function contractMultiplier(
  roll: number,
  p: ContractParams,
  gamma = contractGamma(p),
): number {
  return p.coefMin + (p.coefMax - p.coefMin) * roll ** gamma;
}

export function contractRange(input: number, p: ContractParams): { min: number; max: number } {
  return { min: Math.floor(input * p.coefMin), max: Math.ceil(input * p.coefMax) };
}

/** Вероятность получить больше вложенного: P(k > 1). */
export function contractWinProbability(p: ContractParams, gamma = contractGamma(p)): number {
  if (p.coefMax <= 1) return 0;
  const x = (1 - p.coefMin) / (p.coefMax - p.coefMin);
  return 1 - x ** (1 / gamma);
}

/** Предмет с ценой, ближайшей к целевой; при равенстве — более дешёвый, затем по id. */
export function pickNearestByPrice<T extends { id: string; price: number }>(
  pool: T[],
  target: number,
): T | null {
  let best: T | null = null;
  for (const it of pool) {
    if (!best) {
      best = it;
      continue;
    }
    const d = Math.abs(it.price - target);
    const bd = Math.abs(best.price - target);
    if (
      d < bd ||
      (d === bd && (it.price < best.price || (it.price === best.price && it.id < best.id)))
    )
      best = it;
  }
  return best;
}
