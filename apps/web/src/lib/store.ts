'use client';

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/** localStorage может быть недоступен (приватный режим, превью) — тогда просто не запоминаем. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // игнорируем
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // игнорируем
    }
  },
};

interface UiState {
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  depositOpen: boolean;
  openDeposit: () => void;
  closeDeposit: () => void;
  online: number | null;
  setOnline: (n: number) => void;
}

export const useUi = create<UiState>()((set) => ({
  loginOpen: false,
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
  depositOpen: false,
  openDeposit: () => set({ depositOpen: true }),
  closeDeposit: () => set({ depositOpen: false }),
  online: null,
  setOnline: (online) => set({ online }),
}));

interface PrefsState {
  sound: boolean;
  fast: boolean;
  /** Пользователь закрыл уведомление о cookie. */
  cookiesAck: boolean;
  setSound: (v: boolean) => void;
  setFast: (v: boolean) => void;
  ackCookies: () => void;
}

/** Локальные предпочтения (для гостей); у вошедших синхронизируются с профилем. */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      sound: true,
      fast: false,
      cookiesAck: false,
      setSound: (sound) => set({ sound }),
      setFast: (fast) => set({ fast }),
      ackCookies: () => set({ cookiesAck: true }),
    }),
    // Восстанавливаем после гидратации (Providers), чтобы первый рендер совпадал с SSR.
    { name: 'gr-prefs', storage: createJSONStorage(() => safeStorage), skipHydration: true },
  ),
);

/** true, когда настройки восстановлены из localStorage (до этого показывать «запомненное» нельзя). */
export function usePrefsHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => usePrefs.persist.onFinishHydration(cb),
    () => usePrefs.persist.hasHydrated(),
    () => false,
  );
}
