import { notFound } from 'next/navigation';
import { AdminUserDetail } from '@/components/admin/users';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <AdminUserDetail id={id} />;
}
