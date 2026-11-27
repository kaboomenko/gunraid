'use client';

import { WS_EVENTS, type NotificationDto, type NotificationsDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { useCallback, useState } from 'react';
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

/**
 * Новые уведомления по WebSocket: в список уведомлений, всплывающее сообщение и обновление
 * бонусов. Подписка одна на страницу (AuthEffects): список показывают несколько мест (шапки для
 * разных ширин экрана), и подписка в каждом показывала бы каждое уведомление дважды и считала его
 * за два.
 */
export function useNotificationsLive() {
  const qc = useQueryClient();
  const text = useNotificationText();
  useSocketEvent<NotificationDto>(WS_EVENTS.notificationNew, (n) => {
    let added = false;
    qc.setQueryData<NotificationsDto>(bonusKeys.notifications, (old) => {
      if (!old || old.items.some((x) => x.id === n.id)) return old;
      added = true;
      return { items: [n, ...old.items].slice(0, 30), unread: old.unread + 1 };
    });
    // Уже есть в списке (доставлено повторно) — второй раз не показываем. Списка ещё нет —
    // сообщение показываем, а счётчик придёт с сервера, когда список загрузится.
    if (!added && qc.getQueryData(bonusKeys.notifications)) return;
    toast.info(text(n));
    // Бонусы могли измениться (уровень, приз лидерборда) — обновим связанные данные.
    void qc.invalidateQueries({ queryKey: bonusKeys.level });
    void qc.invalidateQueries({ queryKey: bonusKeys.entitlements });
  });
}

/** Список уведомлений из общего кэша (колокольчик, мобильное меню); enabled = false — без запроса (гость). */
export function useNotificationsList(enabled = true) {
  return useQuery({
    queryKey: bonusKeys.notifications,
    queryFn: () => api.get<NotificationsDto>('/notifications'),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * «Прочитать все»: сервер отмечает, список в кэше обновляется сразу; ошибка не критична. Функция одна на
 * всё время жизни компонента (мобильное меню вызывает её из эффекта при закрытии шторки).
 */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useCallback(async () => {
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
  }, [qc]);
}

/** Плашка уведомления в шторке «Меню»: #26262F, скругление 6, поля 12, текст → время 6. */
const PHONE_ITEM = 'flex flex-col gap-[6px] rounded-[6px] bg-[#26262f] p-3';

/**
 * Содержимое списка уведомлений: заголовок и «Прочитать все» (есть непрочитанные), уведомления или
 * «Пока ничего нового». onNavigate — переход по ссылке уведомления (закрыть поповер или меню).
 * phone — вид для шторки «Меню» телефона (шкала 16 / 12 / 8): заголовка нет (он на строке раздела),
 * «Прочитать все» — строка 36 (иконка 12 + 12 + Medium 12), уведомления — плашки PHONE_ITEM через 3: текст
 * Medium 12 (прочитанные — белые 50 %, у непрочитанных для читалок «Новое»), время 8 белым 30 %. Своей
 * прокрутки нет — прокручивается шторка.
 */
export function NotificationsList({
  onNavigate,
  phone,
}: {
  onNavigate?: () => void;
  phone?: boolean;
}) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const text = useNotificationText();
  const list = useNotificationsList();
  const markAll = useMarkAllRead();
  const unread = list.data?.unread ?? 0;
  if (phone) {
    return (
      <div className="flex flex-col gap-[3px]">
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAll()}
            className="flex h-9 items-center gap-3 rounded-[6px] bg-[#26262f] px-3 text-[12px] font-medium text-white/50 transition-colors hover:bg-[#3e3e50] hover:text-white/80 focus-visible:bg-[#3e3e50]"
          >
            <CheckCheck size={12} className="shrink-0" />
            <span>{t('readAll')}</span>
          </button>
        )}
        {list.data?.items.length ? (
          <ul className="flex flex-col gap-[3px]">
            {list.data.items.map((n) => {
              // Непрочитанное отличается не только цветом: читалке — слово «Новое» перед текстом.
              const body = (
                <>
                  {!n.readAt && <span className="sr-only">{t('new')}</span>}
                  <span
                    className={cn(
                      'text-[12px] font-medium',
                      n.readAt ? 'text-white/50' : 'text-white',
                    )}
                  >
                    {text(n)}
                  </span>
                  <span className="text-[8px] font-medium text-white/30">
                    {format.relativeTime(new Date(n.createdAt), new Date())}
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link
                      href={n.link}
                      onClick={onNavigate}
                      className={cn(
                        PHONE_ITEM,
                        'transition-colors hover:bg-[#3e3e50] focus-visible:bg-[#3e3e50]',
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={PHONE_ITEM}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-[6px] bg-[#26262f] p-3 text-center text-[12px] font-medium text-white/50">
            {t('empty')}
          </p>
        )}
      </div>
    );
  }
  return (
    <>
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
                    onClick={onNavigate}
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
    </>
  );
}

/** Колокольчик уведомлений: список и непрочитанные (новые приходят через useNotificationsLive). */
export function NotificationsBell({ large }: { large?: boolean } = {}) {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const list = useNotificationsList();
  const markAll = useMarkAllRead();

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
        className={
          large
            ? 'relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[12px] bg-bg text-white/30 transition hover:text-white/60'
            : 'clip-cut relative grid h-10 w-9 shrink-0 place-items-center bg-surface-2 text-muted transition hover:text-text [--cut:6px] sm:w-10'
        }
        aria-label={t('open')}
        data-testid="notifications-bell"
      >
        <Bell size={large ? 24 : 18} />
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
          <NotificationsList onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
