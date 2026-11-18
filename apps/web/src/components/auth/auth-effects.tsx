'use client';

import type { ErrorCode } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useBalanceSync } from '@/lib/queries';
import { usePrefs } from '@/lib/store';

/**
 * Обработка результата OAuth-редиректа (?auth=ok, ?linked=steam, ?authError=CODE)
 * и синхронизация локальных настроек звука/быстрого режима с профилем.
 */
export function AuthEffects() {
  const t = useTranslations();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const errorText = useErrorMessage();
  const me = useMe();
  const setSound = usePrefs((s) => s.setSound);
  const setFast = usePrefs((s) => s.setFast);
  useBalanceSync();

  useEffect(() => {
    const auth = params.get('auth');
    const linked = params.get('linked');
    const authError = params.get('authError');
    if (!auth && !linked && !authError) return;
    if (auth === 'ok') toast.success(t('auth.success'));
    if (linked) toast.success(t('auth.linked', { provider: t.has(`providers.${linked}`) ? t(`providers.${linked}`) : linked }));
    if (authError) toast.error(errorText(new ApiError(authError as ErrorCode, 400)));
    const next = new URLSearchParams(params.toString());
    next.delete('auth');
    next.delete('linked');
    next.delete('authError');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (!me.data) return;
    setSound(me.data.settings.soundEnabled);
    setFast(me.data.settings.fastModeDefault);
  }, [me.data, setSound, setFast]);

  return null;
}
