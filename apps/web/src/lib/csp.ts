/**
 * Content-Security-Policy с nonce на каждый запрос: Next.js сам проставляет nonce своим скриптам
 * (все страницы рендерятся динамически). 'strict-dynamic' разрешает скрипты, которые подгружает
 * наш код (виджет входа Telegram). Стили — 'unsafe-inline': React использует style-атрибуты.
 */
const SOCKET_ORIGIN = (() => {
  try {
    return process.env.NEXT_PUBLIC_SOCKET_URL
      ? new URL(process.env.NEXT_PUBLIC_SOCKET_URL).origin
      : '';
  } catch {
    return '';
  }
})();

export function buildCsp(nonce: string, dev: boolean, socketOrigin = SOCKET_ORIGIN): string {
  const connect = ["'self'"];
  if (socketOrigin) connect.push(socketOrigin, socketOrigin.replace(/^http/, 'ws'));
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://telegram.org${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Картинки предметов и аватары могут лежать на внешних CDN (Steam, Google, Telegram).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    'frame-src https://oauth.telegram.org',
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
