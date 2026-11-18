'use client';

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
  setSound: (v: boolean) => void;
  setFast: (v: boolean) => void;
}

/** Локальные предпочтения (для гостей); у вошедших синхронизируются с профилем. */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      sound: true,
      fast: false,
      setSound: (sound) => set({ sound }),
      setFast: (fast) => set({ fast }),
    }),
    { name: 'gr-prefs', storage: createJSONStorage(() => safeStorage) },
  ),
);
