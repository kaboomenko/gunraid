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
  /** Промокод, который подставится в окно пополнения (например, с промо-полосы). */
  depositPromo: string | null;
  /** Аргумент — только строка: функцию передают прямо в onClick, и туда приходит событие. */
  openDeposit: (promo?: unknown) => void;
  closeDeposit: () => void;
  online: number | null;
  setOnline: (n: number) => void;
}

export const useUi = create<UiState>()((set) => ({
  loginOpen: false,
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
  depositOpen: false,
  depositPromo: null,
  openDeposit: (promo) =>
    set({ depositOpen: true, depositPromo: typeof promo === 'string' ? promo : null }),
  closeDeposit: () => set({ depositOpen: false, depositPromo: null }),
  online: null,
  setOnline: (online) => set({ online }),
}));

export type CookieConsent = 'all' | 'necessary';

interface PrefsState {
  sound: boolean;
  fast: boolean;
  /**
   * Выбор в уведомлении о cookie: 'all' — все, 'necessary' — только обязательные, null — ещё не выбран.
   * Необязательные (аналитика) можно включать только при 'all'.
   */
  cookieConsent: CookieConsent | null;
  /** Принял условия публичной оферты в окне входа (запоминается). */
  offerAccepted: boolean;
  setOfferAccepted: (v: boolean) => void;
  setSound: (v: boolean) => void;
  setFast: (v: boolean) => void;
  setCookieConsent: (v: CookieConsent) => void;
}

/** Локальные предпочтения (для гостей); у вошедших синхронизируются с профилем. */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      sound: true,
      fast: false,
      cookieConsent: null,
      offerAccepted: false,
      setOfferAccepted: (offerAccepted) => set({ offerAccepted }),
      setSound: (sound) => set({ sound }),
      setFast: (fast) => set({ fast }),
      setCookieConsent: (cookieConsent) => set({ cookieConsent }),
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
