import type { CaseDetailDto, HomeDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CaseOpener } from '@/components/cases/case-opener';
import { SkinCard } from '@/components/items/skin-card';
import { caseNeighbours } from '@/lib/case-page';
import { getPublicConfig, serverGetOrNull } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

async function load(game: string, slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return serverGetOrNull<CaseDetailDto>(`/games/${game}/cases/${slug}`, { revalidate: 15 });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}): Promise<Metadata> {
  const { game, slug } = await params;
  const [c, t, config] = await Promise.all([
    load(game, slug),
    getTranslations('case'),
    getPublicConfig(),
  ]);
  if (!c) return {};
  const gameName = config.games.find((g) => g.code === game)?.name ?? game;
  return pageMeta({
    title: t('metaTitle', { name: c.name, game: gameName }),
    description: t('metaDescription', { name: c.name, game: gameName, price: c.price }),
    path: `/${game}/case/${slug}`,
    image: c.imageUrl,
  });
}

/**
 * Страница кейса: сцена с кнопками (CaseOpener) и содержимое кейса — сетка карточек 286×185.
 * Отступы — ритм главной: над названием и между сценой и сеткой 40 / 80 / 120 (телефон / планшет /
 * от 1280); над названием на низком экране меньше (.case-page), чтобы кнопка открытия была видна.
 * Соседние кейсы — по каталогу главной (тот же запрос, что у главной, из кэша).
 */
export default async function CasePage({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}) {
  const { game, slug } = await params;
  const [c, home] = await Promise.all([
    load(game, slug),
    serverGetOrNull<HomeDto>(`/games/${game}/home`, { revalidate: 15 }).catch(() => null),
  ]);
  if (!c) notFound();
  const t = await getTranslations('case');
  const neighbours = home ? caseNeighbours(home.categories, c.slug) : null;
  return (
    // Поле страницы сверху уже есть (16 / 24) — .case-page добавляет до 40 / 80 / 120.
    <div className="case-page">
      <CaseOpener key={c.slug} game={game} initial={c} neighbours={neighbours} />
      <section
        className="case-contents mt-10 md:mt-20 xl:mt-[120px]"
        aria-labelledby="case-contents-title"
        data-testid="case-contents"
      >
        <h2 id="case-contents-title" className="sr-only">
          {t('contents')}
        </h2>
        <div className="skin-grid">
          {c.items.map((entry) => (
            <SkinCard
              key={entry.item.id}
              item={entry.item}
              chance={entry.chance}
              href={`/${game}/items/${entry.item.id}`}
              data-testid="case-item"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
