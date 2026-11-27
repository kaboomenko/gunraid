import {
  cargoClientSeed,
  cargoClientSeedPreimage,
  cargoSeatOwner,
  cargoSeatsSold,
  cargoWinningSeat,
  rollFloat,
  sha256Hex,
  type CargoSeatRange,
} from '@gunraid/game-core';
import type { CargoProofDto } from '@gunraid/shared';

/**
 * Чем закончился раунд груза — от этого зависят текст и набор проверок на странице проверки:
 * `open` — раунд идёт (server seed скрыт, видны его хэш и покупки); `landed` — есть победитель;
 * `noSales` — таймер вышел без продаж; `minSeats` — продано меньше минимума (D36), гемы вернули;
 * `cancelled` — отменён админом после продаж (D33); `cancelledEmpty` — отменён до первой покупки.
 * У `minSeats` и `cancelled` пересчитывается место, которое выиграло бы (voidSeat).
 */
export type CargoProofOutcome =
  'open' | 'landed' | 'noSales' | 'minSeats' | 'cancelled' | 'cancelledEmpty';

export function cargoProofOutcome(
  p: Pick<CargoProofDto, 'status' | 'seatsSold' | 'purchases'>,
): CargoProofOutcome {
  if (p.status === 'open') return 'open';
  if (p.status === 'landed') return 'landed';
  // Продажи — по числу мест раунда или по списку: если они расходятся, это покажет проверка мест.
  const sold = p.seatsSold > 0 || p.purchases.length > 0;
  if (p.status === 'expired') return sold ? 'minSeats' : 'noSales';
  return sold ? 'cancelled' : 'cancelledEmpty';
}

/**
 * Проверки по порядку показа: хэш server seed, места подряд, client seed раунда, место победителя
 * (`seat`) или место, которое выиграло бы (`void`), условие закрытия (`reason`).
 */
export type CargoProofCheckKey = 'hash' | 'seats' | 'client' | 'seat' | 'void' | 'reason';

export interface CargoProofCheck {
  key: CargoProofCheckKey;
  ok: boolean;
}

export interface CargoProofVerdict {
  outcome: CargoProofOutcome;
  /** Пусто, пока раунд идёт: server seed ещё не раскрыт, проверять нечего. */
  checks: CargoProofCheck[];
  /** Проданные места по списку покупок; null — покупки идут не подряд (или проверять нечего). */
  sold: number | null;
  /** Client seed раунда, пересчитанный по списку покупок. */
  clientSeed: string | null;
  float: number | null;
  /** Место по пересчёту: выигравшее (`landed`) или то, что выиграло бы (`minSeats`, `cancelled`). */
  seat: number | null;
  /** Индекс покупки, которой принадлежит это место (подсветка в списке). */
  seatOwner: number | null;
}

/**
 * Условие закрытия сходится с числами раунда (W5). Причину сервер выбирает сам, и без этой проверки он мог бы
 * незаметно аннулировать неудобный раунд «по минимуму» или посадить груз до распродажи и до срока:
 * - приземлился, «все места проданы» — продано ровно столько, сколько мест;
 * - приземлился «по таймеру» — срок вышел (finishedAt ≥ endsAt), минимум продаж (если задан) набран;
 * - закрыт по минимуму — срок вышел, минимум задан, продано меньше него;
 * - без продаж — срок вышел.
 * Отмену админ делает когда угодно (она публична, D33) — её условие не проверяется (null), как и у идущего раунда.
 */
export function cargoReasonOk(
  p: Pick<CargoProofDto, 'landReason' | 'seatsTotal' | 'minSeatsToLand' | 'endsAt' | 'finishedAt'>,
  outcome: CargoProofOutcome,
  sold: number,
): boolean | null {
  const ends = Date.parse(p.endsAt);
  const finished = p.finishedAt === null ? Number.NaN : Date.parse(p.finishedAt);
  // NaN (нет срока или времени закрытия) — ложь: пропущенное поле не делает проверку зелёной.
  const byTimer = finished >= ends;
  const min = p.minSeatsToLand;
  switch (outcome) {
    case 'landed':
      if (p.landReason === 'sold_out') return sold === p.seatsTotal;
      if (p.landReason === 'deadline') return byTimer && (min === null || sold >= min);
      return false;
    case 'minSeats':
      return p.landReason === 'min_seats' && byTimer && min !== null && sold > 0 && sold < min;
    case 'noSales':
      return p.landReason === 'deadline' && byTimer;
    default:
      return null;
  }
}

/**
 * Проверка раунда груза в браузере кодом game-core (D4): хэш раскрытого server seed, места подряд с №1,
 * client seed раунда = SHA-256 списка покупок и место = floor(float × проданных) + 1. Место считается от
 * пересчитанных client seed и числа мест, а не от присланных сервером: их сверяют отдельные проверки. Последняя —
 * условие закрытия (cargoReasonOk).
 */
export function verifyCargoProof(p: CargoProofDto): CargoProofVerdict {
  const outcome = cargoProofOutcome(p);
  const verdict: CargoProofVerdict = {
    outcome,
    checks: [],
    sold: null,
    clientSeed: null,
    float: null,
    seat: null,
    seatOwner: null,
  };
  if (outcome === 'open') return verdict;
  const serverSeed = p.serverSeed;
  verdict.checks.push({
    key: 'hash',
    ok: serverSeed !== null && sha256Hex(serverSeed) === p.serverSeedHash,
  });
  if (outcome === 'cancelledEmpty') return verdict;
  if (outcome === 'noSales') {
    verdict.checks.push({ key: 'reason', ok: cargoReasonOk(p, outcome, 0) === true });
    return verdict;
  }

  try {
    verdict.sold = cargoSeatsSold(p.purchases);
  } catch {
    verdict.sold = null; // пропуск или наложение мест
  }
  verdict.checks.push({ key: 'seats', ok: verdict.sold === p.seatsSold });
  const clientSeed = cargoClientSeed(p.purchases);
  verdict.clientSeed = clientSeed;
  verdict.checks.push({ key: 'client', ok: clientSeed === p.clientSeed });

  const sold = verdict.sold ?? p.seatsSold;
  if (serverSeed !== null && sold > 0) {
    verdict.float = rollFloat(serverSeed, clientSeed, 0);
    verdict.seat = cargoWinningSeat(serverSeed, clientSeed, sold);
    try {
      verdict.seatOwner = p.purchases.indexOf(cargoSeatOwner(p.purchases, verdict.seat));
    } catch {
      verdict.seatOwner = null; // у места нет покупки — места не подряд, это уже красная проверка
    }
  }
  const expected = outcome === 'landed' ? p.winningSeat : p.voidSeat;
  verdict.checks.push({
    key: outcome === 'landed' ? 'seat' : 'void',
    ok: verdict.seat !== null && verdict.seat === expected,
  });
  const reason = cargoReasonOk(p, outcome, sold);
  if (reason !== null) verdict.checks.push({ key: 'reason', ok: reason });
  return verdict;
}

/**
 * Начало строки для SHA-256 (D4) — первые `count` покупок, чтобы проверку можно было повторить вне сайта:
 * если покупок больше, строка обрывается перед закрывающей скобкой и продолжается «,…».
 */
export function cargoPreimageHead(purchases: readonly CargoSeatRange[], count = 3): string {
  const head = cargoClientSeedPreimage(purchases.slice(0, count));
  return purchases.length > count ? `${head.slice(0, -1)},…` : head;
}

/** Сколько первых покупок список держит в DOM, пока не нажали «Показать все». */
export const CARGO_PROOF_HEAD = 200;

/**
 * Строк в группе полного списка («Показать все», до 10 000 покупок — D38). content-visibility — на группе, а не на
 * каждой строке: браузер на каждом кадре прокрутки пересчитывает видимость всех таких элементов, и 10 000 строк
 * с ним прокручивались рывками; 100 групп — нет, а строки вне окна списка по-прежнему не раскладываются.
 */
export const CARGO_PROOF_GROUP = 100;

/** Список частями по `size` подряд (группы полного списка покупок). */
export function cargoProofChunks<T>(list: readonly T[], size = CARGO_PROOF_GROUP): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type CargoProofRow = { kind: 'row'; index: number } | { kind: 'gap'; count: number };

/**
 * Строки списка покупок в DOM: первые `head` покупок, за ними по порядку мест — закреплённые (место
 * победителя или «выиграло бы») и свои (не больше `head` штук), между ними — разрывы с числом скрытых
 * покупок. `showAll` — все покупки подряд. Это только показ: проверки всегда считаются по полному списку,
 * а 10 000 строк разом (D38) заметно тормозят страницу.
 */
export function cargoProofRows(
  total: number,
  marked: { mine: readonly number[]; pinned: readonly number[] },
  showAll = false,
  head = CARGO_PROOF_HEAD,
): CargoProofRow[] {
  const rows: CargoProofRow[] = [];
  const shown = showAll ? total : Math.min(total, head);
  for (let i = 0; i < shown; i++) rows.push({ kind: 'row', index: i });
  if (shown === total) return rows;
  const tail = (list: readonly number[]) => [
    ...new Set(list.filter((i) => Number.isInteger(i) && i >= head && i < total)),
  ];
  const mine = tail(marked.mine)
    .sort((a, b) => a - b)
    .slice(0, head);
  const extra = new Set([...tail(marked.pinned), ...mine]);
  let next = head;
  for (const i of [...extra].sort((a, b) => a - b)) {
    if (i > next) rows.push({ kind: 'gap', count: i - next });
    rows.push({ kind: 'row', index: i });
    next = i + 1;
  }
  if (next < total) rows.push({ kind: 'gap', count: total - next });
  return rows;
}
