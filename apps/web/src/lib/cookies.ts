/** Работа с не-httpOnly cookie в браузере (CSRF, выбранная игра). */
export function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (part.slice(0, idx) === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1));
      } catch {
        return part.slice(idx + 1);
      }
    }
  }
  return undefined;
}

export function setCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}
