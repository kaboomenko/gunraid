import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="font-display text-7xl font-extrabold text-accent">404</div>
      <h1 className="font-display text-2xl font-bold uppercase">{t('title')}</h1>
      <p className="text-muted">{t('text')}</p>
      <Button asChild>
        <Link href="/">{t('home')}</Link>
      </Button>
    </div>
  );
}
