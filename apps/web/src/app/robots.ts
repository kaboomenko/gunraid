import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Служебные и персональные страницы не индексируем.
        disallow: ['/admin', '/api/', '/pay/', '/dev/', '/r/', '/*/profile', '/*/battles/new'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
