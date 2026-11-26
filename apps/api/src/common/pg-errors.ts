import { DrizzleQueryError } from 'drizzle-orm';

/** Код ошибки PostgreSQL (drizzle оборачивает ошибку pg в cause). */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === '23505';
export const isCheckViolation = (err: unknown) => pgErrorCode(err) === '23514';
export const isSerializationFailure = (err: unknown) =>
  ['40001', '40P01'].includes(pgErrorCode(err) ?? '');

/** Обёртка drizzle над ошибкой запроса (и при другом экземпляре drizzle-orm — по полям query и params). */
const isQueryError = (err: unknown): err is Error & { cause?: unknown } =>
  err instanceof DrizzleQueryError || (err instanceof Error && 'query' in err && 'params' in err);

/**
 * Текст ошибки для логов и полей вида `last_error`: причина и код PostgreSQL, без SQL и параметров. У ошибки
 * запроса drizzle message — «Failed query: <sql>\nparams: <значения>» (там id игроков и ещё не раскрытый исход
 * раунда), а сама ошибка pg — в cause.
 */
export function errorText(err: unknown): string {
  let cur: unknown = err;
  for (let i = 0; i < 5 && isQueryError(cur); i++) cur = cur.cause;
  if (isQueryError(cur) || (isQueryError(err) && cur == null)) return 'Failed query';
  const message = cur instanceof Error ? cur.message : String(cur);
  const code = pgErrorCode(cur);
  return code ? `[${code}] ${message}` : message;
}
