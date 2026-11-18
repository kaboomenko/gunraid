'use client';

import { LINKABLE_PROVIDERS, type LinkableProvider, type MeDto } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, LogIn } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useGameCode } from '@/lib/game';
import { useErrorMessage } from '@/lib/errors';
import { ME_KEY, useMe } from '@/lib/me';
import { useUi } from '@/lib/store';
import { TelegramWidget } from '../auth/telegram-widget';
import { HistoryPanel } from './history-panel';
import { InventoryPanel } from './inventory-panel';
import { SettingsPanel } from './settings-panel';
import { StatsRow } from './stats-row';

const TABS = ['inventory', 'history', 'settings', 'referrals'] as const;
type Tab = (typeof TABS)[number];

export function ProfileView() {
  const t = useTranslations();
  const me = useMe();
  const openLogin = useUi((s) => s.openLogin);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const game = useGameCode();
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : 'inventory';

  if (me.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!me.data) {
    return (
      <EmptyState
        icon={<LogIn size={36} />}
        title={t('header.login')}
        text={t('errors.UNAUTHORIZED')}
        action={<Button onClick={openLogin}>{t('header.login')}</Button>}
      />
    );
  }
  const data = me.data;
  return (
    <div className="space-y-5">
      <ProfileHeader me={data} />
      <StatsRow game={game} />
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}
      >
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`profile.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="inventory">
          <InventoryPanel game={game} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryPanel game={game} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsPanel me={data} />
        </TabsContent>
        <TabsContent value="referrals">
          <ReferralBlock code={data.referralCode} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileHeader({ me }: { me: MeDto }) {
  const t = useTranslations();
  const format = useFormatter();
  return (
    <Card cut="lg" className="stripes p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <Avatar src={me.avatarUrl} name={me.nickname} size="xl" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-extrabold">{me.nickname}</h1>
              {me.role !== 'user' && <Badge tone="soft">{t(`roles.${me.role}`)}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
              <span>{t('profile.id', { id: me.shortId })}</span>
              <span>
                {t('profile.since', {
                  date: format.dateTime(new Date(me.createdAt), { dateStyle: 'long' }),
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="accent">{t('profile.level', { level: me.level })}</Badge>
              <span className="text-xs text-muted">{t('profile.xp', { xp: me.xp })}</span>
            </div>
          </div>
        </div>
        <div className="md:ml-auto">
          <LinkedAccounts me={me} />
        </div>
      </div>
    </Card>
  );
}

function LinkedAccounts({ me }: { me: MeDto }) {
  const t = useTranslations();
  const config = useConfig();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const pathname = usePathname();
  const available: LinkableProvider[] = LINKABLE_PROVIDERS.filter(
    (p) =>
      (p === 'steam' && config.auth.steam) ||
      (p === 'google' && config.auth.google) ||
      (p === 'telegram' && config.auth.telegram),
  );

  const unlink = async (provider: string) => {
    try {
      const updated = await api.delete<MeDto>(`/me/identities/${provider}`);
      qc.setQueryData(ME_KEY, updated);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
        {t('profile.accounts')}
      </div>
      <div className="flex flex-wrap gap-2">
        {me.identities.map((i) => (
          <div
            key={i.provider}
            className="clip-cut flex items-center gap-2 bg-surface-3 py-1.5 pl-3 pr-1.5 text-xs [--cut:6px]"
          >
            <span className="font-semibold">{t(`providers.${i.provider}`)}</span>
            <span className="max-w-[140px] truncate text-dim">{i.displayName}</span>
            {me.identities.length > 1 && (
              <button
                type="button"
                className="px-1.5 text-dim transition hover:text-danger"
                onClick={() => void unlink(i.provider)}
                aria-label={t('profile.unlink')}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {available
          .filter((p) => !me.identities.some((i) => i.provider === p))
          .map((p) =>
            p === 'telegram' ? (
              <TelegramWidget
                key={p}
                intent="link"
                onAuth={(payload) =>
                  void api
                    .post('/auth/telegram', payload)
                    .then(() => qc.invalidateQueries({ queryKey: ME_KEY }))
                    .catch((err: unknown) => toast.error(errorText(err)))
                }
              />
            ) : (
              <Button key={p} asChild size="sm" variant="outline">
                <a href={`/api/v1/auth/${p}?intent=link&returnTo=${encodeURIComponent(pathname)}`}>
                  {t('profile.link')} {t(`providers.${p}`)}
                </a>
              </Button>
            ),
          )}
      </div>
    </div>
  );
}

function ReferralBlock({ code }: { code: string }) {
  const t = useTranslations();
  const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${code}` : `/r/${code}`;
  return (
    <Card className="space-y-3 p-5">
      <div className="font-display text-lg font-bold uppercase">{t('profile.referralTitle')}</div>
      <p className="text-sm text-muted">{t('profile.referralText')}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <code
          className="clip-cut flex h-11 flex-1 items-center truncate bg-surface-2 px-3.5 text-sm [--cut:7px]"
          suppressHydrationWarning
        >
          {link}
        </code>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => toast.success(t('common.copied')));
          }}
        >
          <Copy size={16} /> {t('common.copy')}
        </Button>
      </div>
    </Card>
  );
}
