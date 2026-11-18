import { COOKIES } from '@gunraid/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/shell';
import { serverMeRole } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

/** Доступ проверяется и при рендере (здесь), и в API на каждом запросе. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const role = await serverMeRole(jar.get(COOKIES.access)?.value);
  if (role && role !== 'admin' && role !== 'support') notFound();
  return <AdminShell>{children}</AdminShell>;
}
