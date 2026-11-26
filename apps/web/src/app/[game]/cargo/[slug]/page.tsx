import { CARGO_SLUG_RE, type CargoDetailDto, type CargoListDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CargoStage } from '@/components/cargo/cargo-stage';
import { cargoNeighbours } from '@/lib/cargo-page';
import { getPublicConfig, serverGetOrNull } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

async function load(game: string, slug: string) {
  if (!CARGO_SLUG_RE.test(slug)) return null;
  // Без кэша, как у баттла: по этой детальной ставятся часы таймера (noteServerTime) — устаревший ответ
  // stale-while-revalidate дал бы скачок таймера и уже приземлившийся раунд в первом кадре. Список — 15 с.
  return serverGetOrNull<CargoDetailDto>(`/games/${game}/cargo/${slug}`, { revalidate: 0 });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}): Promise<Metadata> {
  const { game, slug } = await params;
  const [d, t, config] = await Promise.all([
    load(game, slug),
    getTranslations('cargo'),
    getPublicConfig(),
  ]);
  if (!d) return {};
  const gameName = config.games.find((g) => g.code === game)?.name ?? game;
  const prize = d.round?.prize.fullName ?? d.name;
  return pageMeta({
    title: t('metaTitle', { name: d.name, game: gameName, prize }),
    description: t('metaDescription', { name: d.name, game: gameName, prize }),
    path: `/${game}/cargo/${slug}`,
    image: d.imageUrl,
  });
}

/**
 * Страница груза: сцена на всю ширину экрана (.cargo-page снимает поля страницы, фон-сцена — до краёв
 * окна). Стрелки ведут к соседним грузам игры — по списку грузов (тот же запрос, что у «Грузов», из кэша).
 */
export default async function CargoPage({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}) {
  const { game, slug } = await params;
  const [d, list] = await Promise.all([
    load(game, slug),
    serverGetOrNull<CargoListDto>(`/games/${game}/cargo`, { revalidate: 15 }).catch(() => null),
  ]);
  if (!d) notFound();
  const neighbours = list ? cargoNeighbours(list.items, d.slug) : null;
  return (
    <div className="cargo-page">
      <CargoStage key={d.slug} game={game} initial={d} neighbours={neighbours} />
    </div>
  );
}
