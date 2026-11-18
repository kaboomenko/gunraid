import { AdminOnly } from '@/components/admin/shell';
import { AdminBonuses } from '@/components/admin/bonuses';

export default function Page() {
  return (
    <AdminOnly>
      <AdminBonuses />
    </AdminOnly>
  );
}
