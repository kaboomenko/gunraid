import { notFound } from 'next/navigation';
import { getPublicConfig } from '@/lib/server-api';
import { Showcase } from './showcase';

/** Витрина дизайн-системы — только когда включён dev-режим (не в production). */
export default async function DevUiPage() {
  const config = await getPublicConfig();
  if (!config.auth.dev) notFound();
  return <Showcase />;
}
