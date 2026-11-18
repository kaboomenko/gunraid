/**
 * Внутренняя валюта — гемы. 1 гем — минимальная единица, дробных гемов нет.
 * Курс к доллару — настройка currency.gemsPerUsd, не константа.
 */
const groupFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function isGemAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertGemAmount(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of gems, got ${value}`);
  }
  return value;
}

/** «12 345» — число гемов с разделителями разрядов (без слова «гем»; склонение — через i18n). */
export function formatGems(value: number): string {
  return groupFormatter.format(value);
}

/** Компактная запись для узких мест: 12,3 тыс. → «12.3K». */
export function formatGemsCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 100_000) return formatGems(value);
  if (abs < 1_000_000) return `${trimZero((value / 1000).toFixed(1))}K`;
  return `${trimZero((value / 1_000_000).toFixed(2))}M`;
}

function trimZero(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Строка с курсом для подсказок: «100 гемов = $1» строит i18n, здесь — только число. */
export function gemsForUsd(usd: number, gemsPerUsd: number): number {
  return Math.round(usd * gemsPerUsd);
}

/**
 * Точная десятичная арифметика для котировок пополнения: строки → масштабированные BigInt.
 * Используется, чтобы не терять гемы на float при пересчёте валют.
 */
export const DECIMAL_SCALE = 18;
const SCALE_BIG = 10n ** BigInt(DECIMAL_SCALE);

export function parseDecimal(value: string): bigint {
  const s = value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new RangeError(`invalid decimal: ${value}`);
  const [intPart = '0', fracPart = ''] = s.split('.');
  if (fracPart.length > DECIMAL_SCALE) throw new RangeError(`too many decimals: ${value}`);
  return BigInt(intPart) * SCALE_BIG + BigInt(fracPart.padEnd(DECIMAL_SCALE, '0'));
}

export function formatDecimal(scaled: bigint, maxFraction = 8): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_BIG;
  let frac = (abs % SCALE_BIG).toString().padStart(DECIMAL_SCALE, '0').slice(0, maxFraction);
  frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
}

/**
 * Сколько гемов начислить за оплату: floor(amount × usdRate × gemsPerUsd).
 * amount и usdRate — десятичные строки; округление всегда вниз до целого гема.
 */
export function quoteGems(amount: string, usdRate: string, gemsPerUsd: number): number {
  const a = parseDecimal(amount);
  const r = parseDecimal(usdRate);
  const gemsScaled = (a * r * BigInt(gemsPerUsd)) / SCALE_BIG; // всё ещё масштаб SCALE
  const whole = gemsScaled / SCALE_BIG;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('quote overflow');
  return Number(whole);
}

/** Цена в долларах (строка) → гемы с округлением до ближайшего целого (импорт каталога). */
export function usdToGemsRounded(usd: string, gemsPerUsd: number): number {
  const scaled = parseDecimal(usd) * BigInt(gemsPerUsd);
  const whole = scaled / SCALE_BIG;
  const rest = scaled % SCALE_BIG;
  const rounded = rest * 2n >= SCALE_BIG ? whole + 1n : whole;
  return Number(rounded);
}
