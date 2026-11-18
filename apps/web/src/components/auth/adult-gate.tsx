'use client';

import type { MeDto } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { ME_KEY, useMe } from '@/lib/me';
import { reconnectSocket } from '@/lib/socket';

/** Подтверждение 18+ при первом входе: чекбокс, дата и IP пишутся в БД. */
export function AdultGate() {
  const t = useTranslations('age');
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = Boolean(me.data && !me.data.adultConfirmed);

  const confirm = async () => {
    setBusy(true);
    try {
      const updated = await api.post<MeDto>('/me/confirm-age', { confirm: true });
      qc.setQueryData(ME_KEY, updated);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.setQueryData(ME_KEY, null);
    reconnectSocket();
  };

  return (
    <Modal open={open} onOpenChange={() => undefined} title={t('title')} persistent size="sm">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <span className="clip-cut grid h-14 w-16 shrink-0 place-items-center bg-danger font-display text-xl font-extrabold [--cut:8px]">
            18+
          </span>
          <p className="text-sm text-muted">{t('text')}</p>
        </div>
        <Checkbox id="adult-confirm" checked={checked} onCheckedChange={setChecked} label={t('checkbox')} />
        <Button size="lg" block disabled={!checked} loading={busy} onClick={() => void confirm()} data-testid="adult-confirm">
          {t('submit')}
        </Button>
        <button type="button" className="text-xs text-dim underline-offset-2 hover:underline" onClick={() => void logout()}>
          {t('logout')}
        </button>
      </div>
    </Modal>
  );
}
