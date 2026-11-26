import {
  cargoImageVariant,
  type CargoBuyResultDto,
  type CargoCardDto,
  type CargoDetailDto,
  type CargoMyPurchaseDto,
  type CargoResultDto,
  type CargoSeatsEventDto,
} from '@gunraid/shared';

export interface CargoNeighbour {
  slug: string;
  name: string;
  imageUrl: string;
}

export interface CargoNeighbours {
  prev: CargoNeighbour;
  next: CargoNeighbour;
}

/**
 * Соседние грузы для стрелок: порядок — как в списке грузов игры (sort_order), по кругу: у первого
 * слева последний. Груза в списке нет (выключен, раунд не открыт) или он там один — стрелок нет.
 */
export function cargoNeighbours(
  list: readonly CargoCardDto[],
  slug: string,
): CargoNeighbours | null {
  const i = list.findIndex((c) => c.slug === slug);
  if (i < 0 || list.length < 2) return null;
  const at = (k: number): CargoNeighbour => {
    const c = list[(k + list.length) % list.length]!;
    return { slug: c.slug, name: c.name, imageUrl: c.imageUrl };
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

/**
 * Шанс на карточке приза, в процентах строкой (как у шанса в кейсе — для formatChance): (мои места +
 * выбранные) / все места. Это нижняя граница: если распродадут не всё, шанс выше. Не больше 100.
 */
export function cargoChance(mine: number, count: number, total: number): string {
  if (!(total > 0)) return '0';
  return String(Math.min(100, ((mine + count) / total) * 100));
}

/**
 * Обратный отсчёт до приземления: часы целиком (могут быть больше 24 и трёхзначными), каждое поле —
 * не короче двух цифр. Секунды округляются вверх: «00:00:00» — ровно в момент срока, а не за секунду до.
 */
export function splitCountdown(ms: number): { hours: string; minutes: string; seconds: string } {
  const s = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    hours: pad(Math.floor(s / 3600)),
    minutes: pad(Math.floor((s % 3600) / 60)),
    seconds: pad(s % 60),
  };
}

/** Выбранное количество мест — в пределах 1…max; max ≤ 0 (купить нельзя, кнопки выключены) — 1. */
export function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value) || !(max > 0)) return 1;
  return Math.min(Math.max(1, Math.floor(value)), Math.floor(max));
}

/**
 * Шаг стрелкой ↑/↓ в поле количества: от набранного, но ещё не подтверждённого числа (черновик), а без
 * него — от выбранного; результат — в пределах 1…max.
 */
export function stepCount(draft: string | null, value: number, delta: number, max: number): number {
  const typed = draft === null ? Number.NaN : Number.parseInt(draft, 10);
  const base = Number.isFinite(typed) ? clampCount(typed, max) : value;
  return clampCount(base + delta, max);
}

/** Client seed покупки (обязателен, D5): 16 случайных байт — 32 hex-символа, подходит под CARGO_SEED_RE. */
export function randomClientSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Данные груза, когда известно, что продано sold мест: проданных — не меньше, чем уже известно (события
 * и ответы могут прийти не по порядку). Сколько можно взять за раз — не больше свободных: иначе
 * выбранное количество осталось бы больше свободных и покупка получила бы лишний CARGO_SEATS_LEFT.
 */
function withSeatsSold(d: CargoDetailDto, sold: number): CargoDetailDto {
  const r = d.round;
  if (!r || sold <= r.seatsSold) return d;
  const seatsSold = Math.min(sold, r.seatsTotal);
  const left = r.seatsTotal - seatsSold;
  const a = d.availability;
  const availability =
    left > 0
      ? { ...a, maxBuy: Math.min(a.maxBuy, left) }
      : {
          ...a,
          maxBuy: 0,
          canBuy: false,
          // Срок вышел или раунда нет — эти причины сервер называет раньше распродажи.
          reason:
            a.reason === 'CLOSED' || a.reason === 'UNAVAILABLE' ? a.reason : ('SOLD_OUT' as const),
        };
  return { ...d, round: { ...r, seatsSold }, availability };
}

/** Событие cargo:seats → данные груза: только тот же раунд. */
export function mergeSeats(d: CargoDetailDto, e: CargoSeatsEventDto): CargoDetailDto {
  return d.round?.id === e.roundId ? withSeatsSold(d, e.seatsSold) : d;
}

/**
 * Ответ покупки → данные груза: раунд и доступность из ответа, только если раунд тот же (пока шёл ответ, он
 * мог смениться). Ответ посчитан в своей транзакции, а сокет мог уже принести покупки, сделанные после
 * неё: известные продажи не теряются, и сколько можно взять — не больше оставшихся свободных.
 */
export function mergeBuyResult(d: CargoDetailDto, res: CargoBuyResultDto): CargoDetailDto {
  const r = d.round;
  if (!r || r.id !== res.roundId) return d;
  return withSeatsSold({ ...d, round: res.round, availability: res.availability }, r.seatsSold);
}

/**
 * Итог, который страница пропустила: последний завершённый раунд груза — из тех, что страница показывала
 * (а не завершившийся до захода на неё), и его итог ещё не показан (сокет лежал, событие потерялось).
 * Иначе null.
 */
export function missedResult(
  last: CargoResultDto | null,
  seen: ReadonlySet<string>,
  shown: ReadonlySet<string>,
): CargoResultDto | null {
  return last && seen.has(last.roundId) && !shown.has(last.roundId) ? last : null;
}

/**
 * Места игрока в раунде строкой: «№1–4, №7». Соседние покупки склеиваются (1–2 и 3–4 → №1–4), одно
 * место — «№7»; первые max диапазонов — текстом, сколько осталось — числом more («и ещё N»).
 */
export function formatSeatRanges(
  purchases: readonly CargoMyPurchaseDto[],
  max = 3,
): { text: string; more: number } {
  const ranges: Array<[number, number]> = [];
  for (const p of [...purchases].sort((a, b) => a.seatFrom - b.seatFrom)) {
    const last = ranges[ranges.length - 1];
    if (last && p.seatFrom <= last[1] + 1) last[1] = Math.max(last[1], p.seatTo);
    else ranges.push([p.seatFrom, p.seatTo]);
  }
  const parts = ranges.map(([from, to]) => (from === to ? `№${from}` : `№${from}–${to}`));
  return { text: parts.slice(0, max).join(', '), more: Math.max(0, parts.length - max) };
}

/** srcset картинки груза: у стандартной — копии 500 и 1000 px (§W.1), у своей (путь из админки) — нет. */
export function cargoImageSrcSet(url: string): string | undefined {
  const small = cargoImageVariant(url, 500);
  if (small === url) return undefined;
  return `${small} 500w, ${cargoImageVariant(url, 1000)} 1000w`;
}
