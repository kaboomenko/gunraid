import type { PublicProfileStatsDto, PublicUserDto } from '@gunraid/shared';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ItemTile } from '@/components/items/item-tile';
import { Card } from '@/components/ui/card';
import { serverGetOrNull } from '@/lib/server-api';

async function load(shortId: string): Promise<PublicUserDto | null> {
  if (!/^\d{1,15}$/.test(shortId)) return null;
  return serverGetOrNull<PublicUserDto>(`/users/${shortId}`, { revalidate: 30 });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shortId: string }>;
}): Promise<Metadata> {
  const { shortId } = await params;
  const [t, user] = await Promise.all([getTranslations('profile'), load(shortId)]);
  return {
    title: user ? t('publicTitle', { nickname: user.nickname }) : t('notFound'),
    robots: { index: false },
  };
}

export default async function PublicProfile({
  params,
}: {
  params: Promise<{ game: string; shortId: string }>;
}) {
  const { game, shortId } = await params;
  const user = await load(shortId);
  if (!user) notFound();
  const [t, ts, ti, format, stats] = await Promise.all([
    getTranslations('profile'),
    getTranslations('stats'),
    getTranslations('items'),
    getFormatter(),
    serverGetOrNull<PublicProfileStatsDto>(`/users/${shortId}/stats?game=${game}`, {
      revalidate: 15,
    }),
  ]);
  return (
    <div className="space-y-5">
      <Card cut="lg" className="stripes flex items-center gap-4 p-5 sm:p-6">
        <Avatar src={user.avatarUrl} name={user.nickname} size="xl" />
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-extrabold">{user.nickname}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
            <Badge tone="accent">{t('level', { level: user.level })}</Badge>
            <span>{t('id', { id: user.shortId })}</span>
            <span>
              {t('since', {
                date: format.dateTime(new Date(user.createdAt), { dateStyle: 'long' }),
              })}
            </span>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-dim">{ts('bestDrop')}</div>
          {stats?.bestDrop ? (
            <ItemTile
              item={stats.bestDrop.item}
              stLabel={ti('stattrakBadge')}
              svLabel={ti('souvenirBadge')}
            />
          ) : (
            <Card cut="sm" className="grid h-40 place-items-center text-xs text-dim">
              {ts('noBestDrop')}
            </Card>
          )}
        </div>
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-dim">
            {ts('recentDrops')}
          </div>
          {stats?.recentDrops.length ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
              {stats.recentDrops.map((d) => (
                <ItemTile
                  key={d.id}
                  item={d.item}
                  size="sm"
                  stLabel={ti('stattrakBadge')}
                  svLabel={ti('souvenirBadge')}
                />
              ))}
            </div>
          ) : (
            <Card cut="sm" className="grid h-40 place-items-center text-xs text-dim">
              {ts('noBestDrop')}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
