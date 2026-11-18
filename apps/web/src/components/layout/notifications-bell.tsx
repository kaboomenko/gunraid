'use client';

import { WS_EVENTS, type NotificationDto, type NotificationsDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { bonusKeys } from '@/lib/queries';
import { useSocketEvent } from '@/lib/socket';

/** Текст уведомления по его типу (суммы — в гемах со склонением). */
export function useNotificationText() {
  const t = useTranslations('notifications.types');
  const tg = useTranslations('gems');
  const tl = useTranslations('leaderboard.periods');
  const tw = useTranslations('withdraw.statuses');
  return (n: NotificationDto) => {
    const p = { ...n.params };
    if (n.type === 'withdrawal_status' && typeof p.status === 'string' && tw.has(p.status)) {
      p.status = tw(p.status);
    }
    if (typeof p.gems === 'number') p.gems = tg('amount', { count: p.gems });
    if (p.period === 'day' || p.period === 'week') p.period = tl(p.period);
    try {
      return t(n.type, p);
    } catch {
      return n.type;
    }
  };
}

/** Колокольчик уведомлений: список, непрочитанные, новые — по WebSocket. */
export function NotificationsBell() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const qc = useQueryClient();
  const text = useNotificationText();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: bonusKeys.notifications,
    queryFn: () => api.get<NotificationsDto>('/notifications'),
    staleTime: 60_000,
  });

  useSocketEvent<NotificationDto>(WS_EVENTS.notificationNew, (n) => {
    qc.setQueryData<NotificationsDto>(bonusKeys.notifications, (old) =>
      old
        ? {
            items: [n, ...old.items.filter((x) => x.id !== n.id)].slice(0, 30),
            unread: old.unread + 1,
          }
        : old,
    );
    toast.info(text(n));
    // Бонусы могли измениться (уровень, приз лидерборда) — обновим связанные данные.
    void qc.invalidateQueries({ queryKey: bonusKeys.level });
    void qc.invalidateQueries({ queryKey: bonusKeys.entitlements });
  });

  const markAll = async () => {
    try {
      const res = await api.post<{ unread: number }>('/notifications/read', {});
      qc.setQueryData<NotificationsDto>(bonusKeys.notifications, (old) =>
        old
          ? {
              unread: res.unread,
              items: old.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })),
            }
          : old,
      );
    } catch {
      // не критично
    }
  };

  const unread = list.data?.unread ?? 0;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && unread > 0) void markAll();
      }}
    >
      <Popover.Trigger
        className="clip-cut relative grid h-10 w-9 shrink-0 place-items-center bg-surface-2 text-muted transition hover:text-text [--cut:6px] sm:w-10"
        aria-label={t('open')}
        data-testid="notifications-bell"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center bg-danger px-1 text-[10px] font-bold leading-none text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="gr-pop cut z-50 w-[min(360px,calc(100vw-24px))] p-2 [--cut-bg:var(--color-surface-2)] [--cut-border:var(--color-line-strong)]"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-display text-sm font-bold uppercase">{t('title')}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="flex items-center gap-1 text-[11px] text-dim hover:text-text"
              >
                <CheckCheck size={13} /> {t('readAll')}
              </button>
            )}
          </div>
          {list.data?.items.length ? (
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.data.items.map((n) => {
                const body = (
                  <>
                    <span className={cn('text-sm', n.readAt ? 'text-muted' : 'text-text')}>
                      {text(n)}
                    </span>
                    <span className="text-[10px] text-dim">
                      {format.relativeTime(new Date(n.createdAt), new Date())}
                    </span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => setOpen(false)}
                        className="flex flex-col gap-0.5 px-2 py-2 hover:bg-surface-3"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex flex-col gap-0.5 px-2 py-2">
                        {!n.readAt && <span className="sr-only">●</span>}
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-dim">{t('empty')}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
