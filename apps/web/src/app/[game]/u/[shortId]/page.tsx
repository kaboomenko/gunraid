import type { PublicUserDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { serverGetOrNull } from '@/lib/server-api';

async function load(shortId: string): Promise<PublicUserDto | null> {
  if (!/^\d{1,15}$/.test(shortId)) return null;
  return serverGetOrNull<PublicUserDto>(`/users/${shortId}`, { revalidate: 30 });
}

export async function generateMetadata({ params }: { params: Promise<{ shortId: string }> }): Promise<Metadata> {
  const { shortId } = await params;
  const [t, user] = await Promise.all([getTranslations('profile'), load(shortId)]);
  return { title: user ? t('publicTitle', { nickname: user.nickname }) : t('notFound'), robots: { index: false } };
}

export default async function PublicProfile({ params }: { params: Promise<{ shortId: string }> }) {
  const { shortId } = await params;
  const user = await load(shortId);
  if (!user) notFound();
  const [t, format] = await Promise.all([getTranslations('profile'), getFormatter()]);
  return (
    <Card cut="lg" className="stripes flex items-center gap-4 p-5 sm:p-6">
      <Avatar src={user.avatarUrl} name={user.nickname} size="xl" />
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-extrabold">{user.nickname}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <Badge tone="accent">{t('level', { level: user.level })}</Badge>
          <span>{t('id', { id: user.shortId })}</span>
          <span>{t('since', { date: format.dateTime(new Date(user.createdAt), { dateStyle: 'long' }) })}</span>
        </div>
      </div>
    </Card>
  );
}
