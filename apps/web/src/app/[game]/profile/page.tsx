import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ProfileView } from '@/components/profile/profile-view';
import { Skeleton } from '@/components/ui/skeleton';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('profile'), robots: { index: false } };
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ProfileView />
    </Suspense>
  );
}
