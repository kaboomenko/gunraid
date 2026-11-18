/** Публичный адрес сайта (для canonical, sitemap, OG). Задаётся PUBLIC_URL. */
export function siteUrl(): string {
  return (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
}
