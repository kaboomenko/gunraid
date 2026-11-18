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
