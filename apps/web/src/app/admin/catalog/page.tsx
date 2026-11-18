import { AdminOnly } from '@/components/admin/shell';
import { AdminCatalog } from '@/components/admin/catalog';

export default function Page() {
  return (
    <AdminOnly>
      <AdminCatalog />
    </AdminOnly>
  );
}
