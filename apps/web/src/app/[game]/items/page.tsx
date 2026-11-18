import type { ItemFacetsDto, ItemsPageDto } from '@gunraid/shared';
import { PackageSearch } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';
import { ItemFilters, ItemFiltersSidebar } from '@/components/items/item-filters';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getPublicConfig, serverGet } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

const PASS = [
  'q',
  'rarity',
  'type',
  'model',
  'priceMin',
  'priceMax',
  'stattrak',
  'sort',
  'page',
] as const;

type Search = Record<string, string | string[] | undefined>;

function toQuery(sp: Search): URLSearchParams {
  const qs = new URLSearchParams();
  for (const k of PASS) {
    const v = sp[k];
    if (typeof v === 'string' && v) qs.set(k, v);
  }
  return qs;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('items'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return pageMeta({
    title: t('metaTitle', { game: name }),
    description: t('metaDescription', { game: name }),
    path: `/${game}/items`,
  });
}

export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ game: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ game }, sp] = await Promise.all([params, searchParams]);
  const qs = toQuery(sp);
  qs.set('pageSize', '48');
  const [t, page, facets] = await Promise.all([
    getTranslations('items'),
    serverGet<ItemsPageDto>(`/games/${game}/items?${qs.toString()}`, { revalidate: 30 }),
    serverGet<ItemFacetsDto>(`/games/${game}/items/facets`, { revalidate: 60 }),
  ]);
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const link = (p: number) => {
    const next = toQuery(sp);
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    const s = next.toString();
    return s ? `/${game}/items?${s}` : `/${game}/items`;
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        action={<span className="text-sm text-dim">{t('count', { count: page.total })}</span>}
      >
        {t('title')}
      </SectionTitle>
      <Suspense>
        <ItemFilters facets={facets} />
      </Suspense>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Suspense>
          <ItemFiltersSidebar facets={facets} />
        </Suspense>
        <div className="space-y-5">
          {page.items.length ? (
            <div className="grid grid-cols-2 gap-2.5 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {page.items.map((item) => (
                <Link key={item.id} href={`/${game}/items/${item.id}`} className="block">
                  <ItemTile item={item} stLabel={t('stattrakBadge')} svLabel={t('souvenirBadge')} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<PackageSearch size={36} />} text={t('empty')} />
          )}
          {pages > 1 && (
            <nav
              className="flex items-center justify-center gap-3"
              aria-label={t('page', { page: page.page, pages })}
            >
              <Button
                asChild
                variant="secondary"
                size="sm"
                className={page.page <= 1 ? 'pointer-events-none opacity-40' : ''}
              >
                <Link href={link(page.page - 1)} aria-disabled={page.page <= 1}>
                  {t('prev')}
                </Link>
              </Button>
              <span className="text-sm text-muted">{t('page', { page: page.page, pages })}</span>
              <Button
                asChild
                variant="secondary"
                size="sm"
                className={page.page >= pages ? 'pointer-events-none opacity-40' : ''}
              >
                <Link href={link(page.page + 1)} aria-disabled={page.page >= pages}>
                  {t('next')}
                </Link>
              </Button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
