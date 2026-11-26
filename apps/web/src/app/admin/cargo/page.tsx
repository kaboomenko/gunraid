import { Suspense } from 'react';
import { AdminCargo } from '@/components/admin/cargo';
import { AdminOnly } from '@/components/admin/shell';
import { Skeleton } from '@/components/ui/skeleton';

/** Игра и архив — в адресе (?game=, ?archived=1): список читает их сам, и «Назад» из редактора их сохраняет. */
export default function Page() {
  return (
    <AdminOnly>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminCargo />
      </Suspense>
    </AdminOnly>
  );
}
