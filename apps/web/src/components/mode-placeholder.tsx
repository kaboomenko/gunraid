import { Hammer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SectionTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/** Заглушка раздела, который появится на следующих этапах. */
export async function ModePlaceholder({
  mode,
}: {
  mode: 'upgrade' | 'contract' | 'battles' | 'bonuses' | 'leaderboard';
}) {
  const t = await getTranslations();
  return (
    <div className="space-y-4">
      <SectionTitle>{t(`nav.${mode}`)}</SectionTitle>
      <EmptyState icon={<Hammer size={36} />} title={t('common.soon')} />
    </div>
  );
}
