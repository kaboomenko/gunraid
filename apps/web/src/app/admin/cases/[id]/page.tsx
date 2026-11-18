import { notFound } from 'next/navigation';
import { AdminCaseEditor } from '@/components/admin/cases';
import { AdminOnly } from '@/components/admin/shell';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ game?: string }>;
}) {
  const [{ id }, { game }] = await Promise.all([params, searchParams]);
  if (id !== 'new' && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const g = game && /^[a-z0-9-]{2,32}$/.test(game) ? game : 'standoff2';
  return (
    <AdminOnly>
      <AdminCaseEditor key={id} id={id === 'new' ? null : id} game={g} />
    </AdminOnly>
  );
}
