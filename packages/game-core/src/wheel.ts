/**
 * Колесо фортуны: билет = floor(бросок × сумма весов), приз — по накопленным весам.
 * Тот же код проверяет результат в браузере.
 */
export function pickWeighted(weights: number[], roll: number): { index: number; ticket: number } {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) throw new RangeError('weights must be positive');
  const ticket = Math.min(total - 1, Math.floor(roll * total));
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]!;
    if (ticket < acc) return { index: i, ticket };
  }
  return { index: weights.length - 1, ticket };
}
