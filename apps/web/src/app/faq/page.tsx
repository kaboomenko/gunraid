import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('faq');
  return { title: t('title') };
}

export default async function FaqPage() {
  const t = await getTranslations('faq');
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{t('title')}</h1>
      <Card className="p-5 text-sm text-muted">{t('soon')}</Card>
    </div>
  );
}
