import { notFound } from 'next/navigation';
import { AdminCargoEditor } from '@/components/admin/cargo';
import { AdminOnly } from '@/components/admin/shell';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ game?: string | string[] }>;
}) {
  const [{ id }, { game }] = await Promise.all([params, searchParams]);
  if (id !== 'new' && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Игра нужна новому грузу; у существующего редактор берёт её из шаблона.
  const g = typeof game === 'string' && /^[a-z0-9-]{2,32}$/.test(game) ? game : 'standoff2';
  return (
    <AdminOnly>
      <AdminCargoEditor key={id} id={id === 'new' ? null : id} game={g} />
    </AdminOnly>
  );
}
