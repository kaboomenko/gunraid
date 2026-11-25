import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { FairTools } from './fair-tools';
import { pageMeta } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fair');
  return pageMeta({ title: t('title'), description: t('metaDescription'), path: '/provably-fair' });
}

export default async function FairPage() {
  const t = await getTranslations('fair');
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display-oblique text-3xl font-extrabold uppercase sm:text-4xl">
          {t('title')}
        </h1>
        <p className="text-muted">{t('lead')}</p>
      </div>
      <Card className="space-y-3 p-5 text-sm text-muted">
        <h2 className="font-display text-lg font-bold uppercase text-text">{t('howTitle')}</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
          <li>{t('how4')}</li>
        </ol>
        <div className="text-xs uppercase tracking-wider text-dim">{t('formula')}</div>
        <pre className="clip-cut overflow-x-auto bg-surface-2 p-3 text-xs text-accent [--cut:6px]">
          {
            'hmac = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:0`)\nfloat = parseInt(hmac.slice(0, 13), 16) / 2^52\nticket = floor(float × 10 000 000)'
          }
        </pre>
      </Card>
      <Suspense>
        <FairTools />
      </Suspense>
    </div>
  );
}
