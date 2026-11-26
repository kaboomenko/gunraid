'use client';

import type { MeDto, UpdateSettingsBody } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { ME_KEY } from './me';
import { usePrefs } from './store';

/**
 * Переключатели звука и «Быстро»: выбор действует сразу (локальные настройки), а у вошедшего ещё и
 * сохраняется в профиль — иначе при следующей загрузке страницы профиль вернул бы прежнее значение.
 * Профиль в кэше обновляется сразу (страница настроек показывает то же); не сохранилось — выбор
 * всё равно действует до перезагрузки, профиль перечитывается с сервера.
 */
export function usePrefToggles() {
  const qc = useQueryClient();
  const setSoundLocal = usePrefs((s) => s.setSound);
  const setFastLocal = usePrefs((s) => s.setFast);

  const save = (body: Pick<UpdateSettingsBody, 'soundEnabled' | 'fastModeDefault'>) => {
    if (!qc.getQueryData<MeDto | null>(ME_KEY)) return;
    qc.setQueryData<MeDto | null>(ME_KEY, (me) =>
      me ? { ...me, settings: { ...me.settings, ...body } } : me,
    );
    api.patch<MeDto>('/me/settings', body).catch(() => {
      void qc.invalidateQueries({ queryKey: ME_KEY });
    });
  };

  return {
    setSound: (v: boolean) => {
      setSoundLocal(v);
      save({ soundEnabled: v });
    },
    setFast: (v: boolean) => {
      setFastLocal(v);
      save({ fastModeDefault: v });
    },
  };
}
