'use client';

import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, SectionTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/me';

/** Оболочка админки: доступ по ролям support/admin (API проверяет роль на каждом запросе). */
export function AdminHome() {
  const t = useTranslations();
  const me = useMe();
  if (me.isLoading) return <Skeleton className="h-48 w-full" />;
  if (!me.data || (me.data.role !== 'admin' && me.data.role !== 'support')) {
    return <EmptyState icon={<ShieldAlert size={36} />} title={t('admin.denied')} text={t('admin.deniedText')} />;
  }
  return (
    <div className="space-y-4">
      <SectionTitle>{t('admin.title')}</SectionTitle>
      <Card className="flex items-center gap-3 p-5">
        <ShieldCheck className="text-accent" />
        <div>
          <div className="font-semibold">{t('admin.welcome', { role: t(`roles.${me.data.role}`) })}</div>
          <div className="text-sm text-muted">{t('admin.sections')}</div>
        </div>
      </Card>
    </div>
  );
}
