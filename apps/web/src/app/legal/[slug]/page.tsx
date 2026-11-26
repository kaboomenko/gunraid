import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { pageMeta } from '@/lib/seo';

// Порядок — как в футере; «Правила сайта», «18+» и «Ответственная игра» — в общем списке внизу страницы.
const SLUGS = [
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
] as const;
type Slug = (typeof SLUGS)[number];
const isSlug = (s: string): s is Slug => (SLUGS as readonly string[]).includes(s);

interface Section {
  title: string;
  text: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSlug(slug)) return {};
  const t = await getTranslations('legal');
  const sections = t.raw(`docs.${slug}`) as Section[];
  return pageMeta({
    title: t(slug),
    description: sections.map((s) => s.title).join(' · '),
    path: `/legal/${slug}`,
  });
}

/**
 * Правовые документы. Структура разделов — черновик; окончательный текст готовит юрист
 * (каждый раздел помечен «TODO: юрист», тексты — в messages/ru.json → legal.docs).
 */
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  const t = await getTranslations('legal');
  const sections = t.raw(`docs.${slug}`) as Section[];
  return (
    <article className="mx-auto max-w-3xl space-y-5" data-testid="legal-doc">
      <h1 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{t(slug)}</h1>
      <p className="border-l-2 border-warning bg-[#262016] px-4 py-3 text-sm text-warning">
        {t('draft')}
      </p>
      <Card className="p-5" cut="sm">
        <div className="mb-2 font-display text-xs font-bold uppercase tracking-widest text-dim">
          {t('contents')}
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {sections.map((s, i) => (
            <li key={s.title}>
              <a href={`#s${i + 1}`} className="text-muted hover:text-text">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </Card>
      {sections.map((s, i) => (
        <section key={s.title} id={`s${i + 1}`} className="scroll-mt-24 space-y-2">
          <h2 className="font-display text-lg font-bold">
            {i + 1}. {s.title}
          </h2>
          <p className="text-sm text-muted">{s.text}</p>
        </section>
      ))}
      <nav className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
        {SLUGS.filter((x) => x !== slug).map((x) => (
          <Link key={x} href={`/legal/${x}`} className="text-muted hover:text-accent">
            {t(x)}
          </Link>
        ))}
      </nav>
    </article>
  );
}
