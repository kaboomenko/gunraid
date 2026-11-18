import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';

const SLUGS = ['terms', 'privacy', 'rules', 'age', 'responsible'] as const;
type Slug = (typeof SLUGS)[number];
const isSlug = (s: string): s is Slug => (SLUGS as readonly string[]).includes(s);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSlug(slug)) return {};
  const t = await getTranslations('legal');
  return { title: t(slug) };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  const t = await getTranslations('legal');
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{t(slug)}</h1>
      <Card className="p-5 text-sm text-muted">{t('placeholder')}</Card>
    </article>
  );
}
