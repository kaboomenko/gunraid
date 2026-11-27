/**
 * Строка, которую PostgreSQL не сохранит как есть: NUL (U+0000 не допускается ни в text, ни в jsonb) или половина
 * суррогатной пары без второй половины (в jsonb — ошибка, в text драйвер молча пишет «�»). Такие строки API
 * отклоняет на входе (400 VALIDATION_ERROR, ZodPipe), а не падает 500 на записи; формы проверяют их заранее.
 */
export function hasUnsafeText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // целая пара — символ вне BMP (эмодзи и т. п.)
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
