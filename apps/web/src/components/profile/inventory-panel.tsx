'use client';

import {
  INVENTORY_SORTS,
  type InventorySort,
  type SellResultDto,
  type UserItemDto,
} from '@gunraid/shared';
import { ArrowUpFromLine, Backpack, CheckSquare, Coins, XSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { WithdrawModal } from '@/components/withdrawals/withdraw-modal';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useInventory, useInvalidateWallet } from '@/lib/queries';

type SellTarget =
  { mode: 'ids'; ids: string[]; total: number } | { mode: 'all'; total: number; count: number };

export function InventoryPanel({ game }: { game: string }) {
  const t = useTranslations();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const [sort, setSort] = useState<InventorySort>('date_desc');
  const inv = useInventory(game, sort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withdrawItem, setWithdrawItem] = useState<UserItemDto | null>(null);
  const [confirm, setConfirm] = useState<SellTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => inv.data?.pages.flatMap((p) => p.items) ?? [], [inv.data]);
  const first = inv.data?.pages[0];
  const selectedSum = items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.item.price, 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sell = async (target: SellTarget) => {
    setBusy(true);
    try {
      const body = target.mode === 'all' ? { all: true } : { userItemIds: target.ids };
      const res = await api.post<SellResultDto>(`/games/${game}/inventory/sell`, body, {
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(
        t('inventory.soldToast', {
          count: res.soldCount,
          gems: t('gems.amount', { count: res.total }),
        }),
      );
      setSelected(new Set());
      setConfirm(null);
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
      invalidate();
    } finally {
      setBusy(false);
    }
  };

  if (inv.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }
  if (!items.length) {
    return <EmptyState icon={<Backpack size={36} />} text={t('inventory.empty')} />;
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-dim">{t('inventory.total')}</span>
          <GemAmount value={first?.totalValue ?? 0} size="lg" className="text-accent" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('inventory.sortLabel')}
            className="clip-cut h-9 bg-surface-3 px-3 text-sm [--cut:6px]"
            value={sort}
            onChange={(e) => setSort(e.target.value as InventorySort)}
          >
            {INVENTORY_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`inventory.sort.${s}`)}
              </option>
            ))}
          </select>
          {selected.size ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <XSquare size={16} /> {t('inventory.clear')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(items.map((i) => i.id)))}
            >
              <CheckSquare size={16} /> {t('inventory.selectAll')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setConfirm({ mode: 'all', total: first?.totalValue ?? 0, count: first?.total ?? 0 })
            }
          >
            {t('inventory.sellAll')}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((ui) => (
          <ItemTile
            key={ui.id}
            item={ui.item}
            stLabel={t('items.stattrakBadge')}
            svLabel={t('items.souvenirBadge')}
            selected={selected.has(ui.id)}
            onClick={() => toggle(ui.id)}
            footer={
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-dim transition hover:text-accent"
                  onClick={() => setConfirm({ mode: 'ids', ids: [ui.id], total: ui.item.price })}
                >
                  <Coins size={12} /> {t('inventory.sell')}
                </button>
                {ui.item.isWithdrawable && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-dim transition hover:text-accent"
                    onClick={() => setWithdrawItem(ui)}
                    data-testid="withdraw-open"
                  >
                    <ArrowUpFromLine size={12} /> {t('withdraw.action')}
                  </button>
                )}
              </span>
            }
          />
        ))}
      </div>

      {inv.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={inv.isFetchingNextPage}
            onClick={() => void inv.fetchNextPage()}
          >
            {t('inventory.loadMore')}
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="pb-safe fixed inset-x-0 bottom-[var(--tabbar-h)] z-30 border-t border-line bg-surface-1/95 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3">
            <div className="text-sm">
              <span className="text-muted">
                {t('inventory.selected', { count: selected.size })}
              </span>{' '}
              <GemAmount value={selectedSum} size="sm" className="text-accent" />
            </div>
            <Button
              onClick={() => setConfirm({ mode: 'ids', ids: [...selected], total: selectedSum })}
            >
              {t('inventory.sellSelected')}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(confirm)}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={t('inventory.sellConfirmTitle')}
        size="sm"
      >
        {confirm && (
          <div className="space-y-5">
            <p className="text-sm text-muted">
              {t('inventory.sellConfirmText', {
                count: confirm.mode === 'all' ? confirm.count : confirm.ids.length,
              })}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-dim">{t('inventory.sold')}</span>
              <GemAmount value={confirm.total} size="lg" className="text-accent" />
            </div>
            <div className="flex gap-3">
              <Button
                block
                loading={busy}
                onClick={() => void sell(confirm)}
                data-testid="confirm-sell"
              >
                {t('inventory.sell')}
              </Button>
              <Button block variant="secondary" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <WithdrawModal game={game} item={withdrawItem} onClose={() => setWithdrawItem(null)} />
    </div>
  );
}
