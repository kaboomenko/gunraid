/**
 * Кейс-баттлы: состав лобби, определение победителя и распределение дропов.
 * Один и тот же код — на сервере (итог) и в браузере (проверка).
 */
export type BattleFormat = '1v1' | '1v1v1' | '1v1v1v1' | '2v2';
export type BattleMode = 'classic' | 'crazy';

const SLOTS: Record<BattleFormat, number> = { '1v1': 2, '1v1v1': 3, '1v1v1v1': 4, '2v2': 4 };

export function battleSlots(format: BattleFormat): number {
  return SLOTS[format];
}

/** Команда слота: в 2×2 слоты 0–1 — команда 0, слоты 2–3 — команда 1; в остальных форматах команд нет. */
export function battleTeamOf(format: BattleFormat, slot: number): number | null {
  if (format !== '2v2') return null;
  return slot < 2 ? 0 : 1;
}

export interface BattleResolution {
  /** Слоты победителей (в 2×2 — оба слота команды). */
  winnerSlots: number[];
  winnerTeam: number | null;
  /** Была ли ничья, решённая дополнительным броском. */
  tie: boolean;
  /** Претенденты при ничьей (слоты или команды) — по возрастанию. */
  candidates: number[];
}

/**
 * Победитель: classic — бо́льшая сумма дропов, crazy — меньшая; в 2×2 — по сумме команды.
 * Ничья решается броском provably fair: candidates[floor(tiebreak × candidates.length)].
 */
export function resolveBattle(
  format: BattleFormat,
  mode: BattleMode,
  totals: number[],
  tiebreak: number,
): BattleResolution {
  const slots = battleSlots(format);
  if (totals.length !== slots) throw new RangeError(`expected ${slots} totals`);
  const scores = format === '2v2' ? [totals[0]! + totals[1]!, totals[2]! + totals[3]!] : totals;
  const best = mode === 'classic' ? Math.max(...scores) : Math.min(...scores);
  const candidates = scores.flatMap((s, i) => (s === best ? [i] : []));
  const tie = candidates.length > 1;
  const pick = tie
    ? candidates[Math.min(candidates.length - 1, Math.floor(tiebreak * candidates.length))]!
    : candidates[0]!;
  if (format === '2v2') {
    return { winnerSlots: pick === 0 ? [0, 1] : [2, 3], winnerTeam: pick, tie, candidates };
  }
  return { winnerSlots: [pick], winnerTeam: null, tie, candidates };
}

/**
 * Кому достаётся дроп слота dropSlot.
 * Обычные форматы — победитель забирает всё.
 * 2×2 (вариант А): каждый победитель забирает свои дропы и дропы соперника из парного слота (0↔2, 1↔3).
 */
export function battleRecipient(
  format: BattleFormat,
  winnerSlots: number[],
  dropSlot: number,
): number {
  if (format !== '2v2') return winnerSlots[0]!;
  if (winnerSlots.includes(dropSlot)) return dropSlot;
  return (dropSlot + 2) % 4;
}

/** Время старта вращения раунда (мс от эпохи). */
export function battleSpinStart(
  startsAtMs: number,
  round: number,
  roundDurationMs: number,
): number {
  return startsAtMs + round * roundDurationMs;
}
