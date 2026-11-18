import { ChevronDown, Send } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { getPublicConfig } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

interface FaqItem {
  q: string;
  a: string;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('faq');
  return pageMeta({ title: t('title'), description: t('metaDescription'), path: '/faq' });
}

/** JSON-LD без возможности «закрыть» тег script содержимым. */
function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function FaqPage() {
  const [t, config] = await Promise.all([getTranslations('faq'), getPublicConfig()]);
  const items = t.raw('items') as FaqItem[];
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <h1 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{t('title')}</h1>
      <div className="space-y-2" data-testid="faq-list">
        {items.map((i) => (
          <Card key={i.q} cut="sm" className="p-0">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 font-semibold [&::-webkit-details-marker]:hidden">
                <span>{i.q}</span>
                <ChevronDown
                  size={18}
                  className="shrink-0 text-dim transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-4 pb-4 text-sm leading-relaxed text-muted">{i.a}</p>
            </details>
          </Card>
        ))}
      </div>
      {config.supportTelegramUrl && (
        <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-muted">
          <span>{t('support')}</span>
          <a
            href={config.supportTelegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="clip-cut inline-flex h-9 items-center gap-2 bg-surface-3 px-3 font-semibold text-text transition hover:bg-line-strong [--cut:6px]"
          >
            <Send size={15} className="text-accent" /> Telegram
          </a>
        </div>
      )}
    </div>
  );
}
