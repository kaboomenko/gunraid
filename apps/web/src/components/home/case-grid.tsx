import type { CaseCardDto, CaseCategoryDto } from '@gunraid/shared';
import { Clock, Crown, Flame } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { SectionTitle } from '@/components/ui/card';
import { CaseCard } from '@/components/ui/case-card';
import { GemAmount } from '@/components/ui/gem';

async function CaseLink({ game, c }: { game: string; c: CaseCardDto }) {
  const t = await getTranslations('case');
  const badge =
    c.supplyTotal !== null ? (
      <Badge tone="warning">
        <Flame size={11} /> {c.supplyTotal - c.supplyUsed}/{c.supplyTotal}
      </Badge>
    ) : c.minLevel ? (
      <Badge tone="info">
        <Crown size={11} /> {t('fromLevel', { level: c.minLevel })}
      </Badge>
    ) : c.cooldownSeconds ? (
      <Badge>
        <Clock size={11} /> {t('everyHours', { hours: Math.round(c.cooldownSeconds / 3600) })}
      </Badge>
    ) : null;
  return (
    <Link href={`/${game}/case/${c.slug}`} className="block" data-testid={`case-card-${c.slug}`}>
      <CaseCard
        name={c.name}
        imageUrl={c.imageUrl}
        price={c.price}
        accentColor={c.accentColor}
        badge={badge}
        priceSlot={
          <div className="clip-cut bg-surface-3 px-3 py-1.5 [--cut:6px]">
            {c.kind === 'free' ? (
              <span className="font-display text-sm font-bold uppercase text-accent">
                {t('free')}
              </span>
            ) : (
              <GemAmount value={c.price} size="sm" />
            )}
          </div>
        }
      />
    </Link>
  );
}

export async function CaseGrid({
  game,
  categories,
}: {
  game: string;
  categories: CaseCategoryDto[];
}) {
  return (
    <div className="space-y-8">
      {categories.map((cat) => (
        <section key={cat.code}>
          <SectionTitle>{cat.name}</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-6">
            {cat.cases.map((c) => (
              <CaseLink key={c.id} game={game} c={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
