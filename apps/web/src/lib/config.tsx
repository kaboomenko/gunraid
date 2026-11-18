'use client';

import type { PublicConfigDto } from '@gunraid/shared';
import { createContext, useContext, type ReactNode } from 'react';

const ConfigContext = createContext<PublicConfigDto | null>(null);

export function ConfigProvider({ value, children }: { value: PublicConfigDto; children: ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): PublicConfigDto {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('ConfigProvider is missing');
  return value;
}
