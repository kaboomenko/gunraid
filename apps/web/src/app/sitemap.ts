import type { HomeDto, ItemsPageDto } from '@gunraid/shared';
import type { MetadataRoute } from 'next';
import { getPublicConfig, serverGet } from '@/lib/server-api';
import { siteUrl } from '@/lib/site';

// Собираем при запросе: каталог и кейсы живут в БД и меняются из админки.
export const dynamic = 'force-dynamic';

const LEGAL = [
  'terms',
  'privacy',
  'payments',
  'refunds',
  'cookies',
  'bonuses',
  'giveaways',
  'rules',
  'age',
  'responsible',
];
const GAME_PAGES = ['', '/upgrade', '/contract', '/battles', '/bonuses', '/leaderboard', '/items'];
const MAX_ITEM_PAGES = 10;

async function gameItems(game: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= MAX_ITEM_PAGES; page++) {
    const res = await serverGet<ItemsPageDto>(`/games/${game}/items?page=${page}&pageSize=120`, {
      revalidate: 600,
    }).catch(() => null);
    if (!res) break;
    ids.push(...res.items.map((i) => i.id));
    if (page * res.pageSize >= res.total) break;
  }
  return ids;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const config = await getPublicConfig();
  // «/» и «/items» — редиректы на выбранную игру, поэтому в карте только страницы игр.
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/provably-fair`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/faq`, changeFrequency: 'monthly', priority: 0.5 },
    ...LEGAL.map((s) => ({
      url: `${base}/legal/${s}`,
      changeFrequency: 'yearly' as const,
      priority: 0.2,
    })),
  ];
  for (const g of config.games) {
    for (const p of GAME_PAGES) {
      entries.push({
        url: `${base}/${g.code}${p}`,
        lastModified: now,
        changeFrequency: p === '' ? 'daily' : 'weekly',
        priority: p === '' ? 1 : 0.6,
      });
    }
    const [home, items] = await Promise.all([
      serverGet<HomeDto>(`/games/${g.code}/home`, { revalidate: 600 }).catch(() => null),
      gameItems(g.code),
    ]);
    const slugs = new Set(home?.categories.flatMap((c) => c.cases.map((x) => x.slug)) ?? []);
    for (const slug of slugs) {
      entries.push({
        url: `${base}/${g.code}/case/${slug}`,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    for (const id of items) {
      entries.push({
        url: `${base}/${g.code}/items/${id}`,
        changeFrequency: 'weekly',
        priority: 0.4,
      });
    }
  }
  return entries;
}
