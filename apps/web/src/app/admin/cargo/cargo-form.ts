import {
  adminCargoSchema,
  CARGO_IMAGE_KINDS,
  CARGO_MAX_SEATS,
  CARGO_SLUG_RE,
  cargoImageUrl,
  type AdminCargoBody,
  type AdminCargoDetailDto,
  type AdminCargoRowDto,
  type CargoImageKind,
  type ItemDto,
} from '@gunraid/shared';

/**
 * Форма шаблона груза в админке (§A.3): черновик полей, проверка до отправки (те же границы, что у
 * adminCargoSchema, и «не больше мест в раунде», которое проверяет сервер) и разбор ошибок API по полям.
 * Без React — чтобы проверять тестами.
 */

/** Поля формы. Числа — строками, как их ввели: пустое необязательное поле — «не задано» (null). */
export interface CargoDraft {
  name: string;
  slug: string;
  imageUrl: string;
  prize: ItemDto | null;
  seatsTotal: string;
  /** Бесплатный груз: цена 0, лимит всегда 1 (D9). Введённые цена и лимит сохраняются в черновике. */
  free: boolean;
  seatPrice: string;
  perUserLimit: string;
  durationMinutes: string;
  minLevel: string;
  depositWithinDays: string;
  minSeatsToLand: string;
  isActive: boolean;
  sortOrder: string;
}

/** Поля с ошибкой — по порядку на форме (фокус уходит на первое). */
export const CARGO_FIELDS = [
  'name',
  'slug',
  'imageUrl',
  'sortOrder',
  'prize',
  'seatsTotal',
  'seatPrice',
  'perUserLimit',
  'durationMinutes',
  'minSeatsToLand',
  'minLevel',
  'depositWithinDays',
] as const;
export type CargoField = (typeof CARGO_FIELDS)[number];

/** Ключи admin.cargo.errors.* для ошибок полей. */
export const CARGO_FIELD_ERROR_KEYS = [
  'required',
  'name',
  'slug',
  'slugTaken',
  'image',
  'prize',
  'prizeMissing',
  'prizeGame',
  'prizeInactive',
  'range',
  'paidPrice',
  'aboveSeats',
] as const;
export type CargoFieldErrorKey = (typeof CARGO_FIELD_ERROR_KEYS)[number];

/** Ошибка поля: ключ текста и числа для подстановки (форматирует интерфейс). */
export interface CargoFieldError {
  key: CargoFieldErrorKey;
  values?: Record<string, number>;
}
export type CargoFieldErrors = Partial<Record<CargoField, CargoFieldError>>;

type IntField = Exclude<CargoField, 'name' | 'slug' | 'imageUrl' | 'prize'>;

/** Границы целых полей — как в adminCargoSchema; цена платного груза — от 1 (0 — это бесплатный). */
export const CARGO_RANGES: Record<IntField, readonly [number, number]> = {
  sortOrder: [0, 100_000],
  seatsTotal: [2, CARGO_MAX_SEATS],
  seatPrice: [1, 1_000_000_000],
  perUserLimit: [1, CARGO_MAX_SEATS],
  durationMinutes: [5, 30 * 24 * 60],
  minSeatsToLand: [1, CARGO_MAX_SEATS],
  minLevel: [1, 1000],
  depositWithinDays: [1, 3650],
};

/** Ключи admin.cargo.errors.* для отказов API, которые не про поле формы (CONFLICT с причиной). */
export const CARGO_CONFLICT_KEYS = ['archived', 'roundOpen', 'busy'] as const;
export type CargoConflictKey = (typeof CARGO_CONFLICT_KEYS)[number];

const INT_RE = /^\d{1,12}$/;

/** Целое из строки поля: '' → null, не число → NaN. */
function parseInt10(s: string): number | null {
  const v = s.trim();
  if (v === '') return null;
  return INT_RE.test(v) ? Number(v) : Number.NaN;
}

/** Ввод в числовое поле: только цифры (как в редакторе кейса). */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '').slice(0, 12);
}

/** Стандартная картинка вида груза, если путь — она; иначе null (свой путь из БД). */
export function cargoImageKind(url: string): CargoImageKind | null {
  return CARGO_IMAGE_KINDS.find((k) => cargoImageUrl(k) === url) ?? null;
}

/** Порядок нового груза — после всех грузов игры (иначе он стал бы первым и открывался по /{game}/cargo). */
export function nextSortOrder(rows: readonly Pick<AdminCargoRowDto, 'sortOrder'>[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
  return Math.min(CARGO_RANGES.sortOrder[1], max + 1);
}

export function newCargoDraft(sortOrder = 0): CargoDraft {
  return {
    name: '',
    slug: '',
    imageUrl: cargoImageUrl('light'),
    prize: null,
    seatsTotal: '100',
    free: false,
    seatPrice: '',
    perUserLimit: '',
    durationMinutes: '1440',
    minLevel: '',
    depositWithinDays: '',
    minSeatsToLand: '',
    isActive: true,
    sortOrder: String(sortOrder),
  };
}

const str = (v: number | null) => (v === null ? '' : String(v));

/** Черновики с одинаковыми значениями полей (приз — по id): есть ли в форме несохранённые правки. */
export function sameCargoDraft(a: CargoDraft, b: CargoDraft): boolean {
  return (Object.keys(a) as Array<keyof CargoDraft>).every((k) =>
    k === 'prize' ? (a.prize?.id ?? null) === (b.prize?.id ?? null) : a[k] === b[k],
  );
}

export function cargoDraftFrom(c: AdminCargoDetailDto): CargoDraft {
  const free = c.seatPrice === 0;
  return {
    name: c.name,
    slug: c.slug,
    imageUrl: c.imageUrl,
    prize: c.prize,
    seatsTotal: String(c.seatsTotal),
    free,
    // У бесплатного в БД цена 0 и лимит 1 — при выключении «бесплатного» поля начинаются пустыми.
    seatPrice: free ? '' : String(c.seatPrice),
    perUserLimit: free ? '' : str(c.perUserLimit),
    durationMinutes: String(c.durationMinutes),
    minLevel: str(c.minLevel),
    depositWithinDays: str(c.depositWithinDays),
    minSeatsToLand: str(c.minSeatsToLand),
    isActive: c.isActive,
    sortOrder: String(c.sortOrder),
  };
}

const rangeError = (field: IntField): CargoFieldError => {
  const [min, max] = CARGO_RANGES[field];
  return { key: 'range', values: { min, max } };
};

/** Целые поля, которые входят в тело: у бесплатного цену и лимит подставляет форма. */
function intFields(d: CargoDraft): Array<[IntField, boolean]> {
  const list: Array<[IntField, boolean]> = [
    ['sortOrder', true],
    ['seatsTotal', true],
    ['durationMinutes', true],
    ['minSeatsToLand', false],
    ['minLevel', false],
    ['depositWithinDays', false],
  ];
  if (!d.free) list.push(['seatPrice', true], ['perUserLimit', false]);
  return list;
}

/** Ошибки черновика (пустой объект — можно отправлять). */
export function cargoDraftErrors(d: CargoDraft): CargoFieldErrors {
  const errors: CargoFieldErrors = {};
  const name = d.name.trim();
  if (name.length < 2 || name.length > 80) errors.name = { key: name ? 'name' : 'required' };
  if (!CARGO_SLUG_RE.test(d.slug)) errors.slug = { key: d.slug ? 'slug' : 'required' };
  const image = d.imageUrl.trim();
  if (!image || image.length > 500) errors.imageUrl = { key: 'image' };
  if (!d.prize) errors.prize = { key: 'prize' };
  for (const [field, required] of intFields(d)) {
    const v = parseInt10(d[field]);
    const [min, max] = CARGO_RANGES[field];
    if (v === null) {
      if (required) errors[field] = { key: 'required' };
    } else if (Number.isNaN(v) || v < min || v > max) {
      errors[field] = field === 'seatPrice' && v === 0 ? { key: 'paidPrice' } : rangeError(field);
    }
  }
  // Как values() на сервере: лимит и минимум продаж — не больше мест в раунде.
  const seats = parseInt10(d.seatsTotal);
  if (!errors.seatsTotal && seats !== null && !Number.isNaN(seats)) {
    for (const field of ['perUserLimit', 'minSeatsToLand'] as const) {
      if (field === 'perUserLimit' && d.free) continue;
      const v = parseInt10(d[field]);
      if (!errors[field] && v !== null && v > seats) {
        errors[field] = { key: 'aboveSeats', values: { max: seats } };
      }
    }
  }
  return errors;
}

/**
 * Тело PUT/POST из черновика без ошибок; null — черновик не проходит adminCargoSchema (страховка: проверки выше
 * повторяют схему, так что этого не должно быть).
 */
export function cargoDraftBody(d: CargoDraft): AdminCargoBody | null {
  if (!d.prize) return null;
  const n = (s: string) => parseInt10(s);
  const body = {
    slug: d.slug,
    name: d.name.trim(),
    imageUrl: d.imageUrl.trim(),
    prizeItemId: d.prize.id,
    seatsTotal: n(d.seatsTotal),
    seatPrice: d.free ? 0 : n(d.seatPrice),
    perUserLimit: d.free ? 1 : n(d.perUserLimit),
    durationMinutes: n(d.durationMinutes),
    minLevel: n(d.minLevel),
    depositWithinDays: n(d.depositWithinDays),
    minSeatsToLand: n(d.minSeatsToLand),
    isActive: d.isActive,
    sortOrder: n(d.sortOrder),
  };
  const parsed = adminCargoSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Поле формы по пути из ошибки схемы на сервере (VALIDATION_ERROR с details-массивом). */
function fieldOfPath(path: string): CargoField | null {
  const head = path.split('.')[0] ?? '';
  if (head === 'prizeItemId') return 'prize';
  return (CARGO_FIELDS as readonly string[]).includes(head) ? (head as CargoField) : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ошибки полей из отказа API (код и details из тела ошибки); то, что не про поле, — пустой объект. */
export function cargoApiFieldErrors(
  code: string,
  details: unknown,
  d: CargoDraft,
): CargoFieldErrors {
  const errors: CargoFieldErrors = {};
  if (code === 'VALIDATION_ERROR') {
    if (
      isRecord(details) &&
      (details.field === 'perUserLimit' || details.field === 'minSeatsToLand')
    ) {
      const seats = parseInt10(d.seatsTotal);
      errors[details.field] = {
        key: 'aboveSeats',
        values: { max: seats !== null && !Number.isNaN(seats) ? seats : CARGO_MAX_SEATS },
      };
    } else if (Array.isArray(details)) {
      for (const issue of details) {
        const field =
          isRecord(issue) && typeof issue.path === 'string' ? fieldOfPath(issue.path) : null;
        if (!field || errors[field]) continue;
        if (field === 'name') errors.name = { key: 'name' };
        else if (field === 'slug') errors.slug = { key: 'slug' };
        else if (field === 'imageUrl') errors.imageUrl = { key: 'image' };
        else if (field === 'prize') errors.prize = { key: 'prize' };
        else errors[field] = rangeError(field);
      }
    }
  } else if (code === 'CARGO_PRIZE_INVALID' && isRecord(details)) {
    const reason = details.reason;
    errors.prize = {
      key:
        reason === 'game' ? 'prizeGame' : reason === 'inactive' ? 'prizeInactive' : 'prizeMissing',
    };
  } else if (code === 'CONFLICT' && isRecord(details) && details.field === 'slug') {
    errors.slug = { key: 'slugTaken' };
  }
  return errors;
}

/** Текст отказа CONFLICT с причиной (архив, открытый раунд, занятый раунд); null — общий текст по коду. */
export function cargoConflictKey(code: string, details: unknown): CargoConflictKey | null {
  if (code !== 'CONFLICT' || !isRecord(details)) return null;
  if (details.reason === 'archived') return 'archived';
  if (details.reason === 'round_open') return 'roundOpen';
  if (details.reason === 'cargo_busy') return 'busy';
  return null;
}

/** Первое поле с ошибкой в порядке формы. */
export function firstErrorField(errors: CargoFieldErrors): CargoField | null {
  return CARGO_FIELDS.find((f) => errors[f]) ?? null;
}

/** Длительность в часах для подсказки (одна цифра после запятой); null — поле не число. */
export function durationHours(minutes: string): number | null {
  const v = parseInt10(minutes);
  return v === null || Number.isNaN(v) ? null : Math.round((v / 60) * 10) / 10;
}

/** RTP при распродаже по черновику: приз / (цена × мест); null — бесплатный или поля не заполнены. */
export function cargoDraftRtp(d: CargoDraft): number | null {
  const seats = parseInt10(d.seatsTotal);
  const price = parseInt10(d.seatPrice);
  // NaN, 0 и null — ложь: RTP не считается.
  if (d.free || !d.prize || !seats || !price) return null;
  return d.prize.price / (price * seats);
}

/** Цена места под целевой RTP при распродаже (как у сидов: приз / (N × 0.9)), не меньше 1. */
export function fitSeatPrice(prizePrice: number, seatsTotal: number, rtp = 0.9): number {
  return Math.max(1, Math.round(prizePrice / (seatsTotal * rtp)));
}

/** Покупки участника строкой «№1–3, №7» (каждая покупка отдельно); первые max — текстом, остальные — числом. */
export function formatCargoRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
  max = 4,
): { text: string; more: number } {
  const parts = ranges.map(([from, to]) => (from === to ? `№${from}` : `№${from}–${to}`));
  return { text: parts.slice(0, max).join(', '), more: Math.max(0, parts.length - max) };
}
