import type { Metadata } from 'next';

/** Общая OG-картинка сайта (scripts/render-og.cjs). */
export const DEFAULT_OG_IMAGE = {
  url: '/brand/og.png',
  width: 1200,
  height: 630,
  alt: 'GunRaid',
};

/** Соцсети не показывают SVG в превью — такие картинки не отдаём в og:image. */
function rasterImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const path = url.split(/[?#]/)[0] ?? '';
  return /\.svg$/i.test(path) ? undefined : url;
}

/**
 * Метаданные публичной страницы: title, description, canonical и Open Graph/Twitter.
 * Без собственной (растровой) картинки подставляется общая OG-картинка сайта.
 */
export function pageMeta(opts: {
  title: string;
  description?: string;
  path: string;
  image?: string | null;
}): Metadata {
  const image = rasterImage(opts.image);
  const fullTitle = `${opts.title} · GunRaid`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: 'website',
      siteName: 'GunRaid',
      locale: 'ru_RU',
      url: opts.path,
      title: fullTitle,
      description: opts.description,
      images: [image ?? DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: opts.description,
      images: [image ?? DEFAULT_OG_IMAGE.url],
    },
  };
}
