import type { CargoListDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { CargoIcon } from '@/components/icons/design-icons';
import { EmptyState } from '@/components/ui/empty-state';
import { getPublicConfig, serverGetOrNull } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('cargo'), getPublicConfig()]);
  const gameName = config.games.find((g) => g.code === game)?.name ?? game;
  return pageMeta({
    title: t('indexTitle', { game: gameName }),
    description: t('indexDescription', { game: gameName }),
    path: `/${game}/cargo`,
  });
}

/** «Грузы»: сразу первый груз игры (по порядку из админки); грузов нет — пустое состояние. */
export default async function CargoIndex({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const list = await serverGetOrNull<CargoListDto>(`/games/${game}/cargo`, {
    revalidate: 15,
  }).catch(() => null);
  const first = list?.items[0];
  // Вне try: redirect бросает NEXT_REDIRECT.
  if (first) redirect(`/${game}/cargo/${first.slug}`);
  const t = await getTranslations('cargo');
  return (
    // EmptyState не принимает data-testid — он на обёртке.
    <div className="mt-10" data-testid="cargo-empty">
      <EmptyState icon={<CargoIcon size={40} />} text={t('empty')} />
    </div>
  );
}
