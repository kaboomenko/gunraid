import { AdminOnly } from '@/components/admin/shell';
import { AdminDeposits } from '@/components/admin/records';

export default function Page() {
  return (
    <AdminOnly>
      <AdminDeposits />
    </AdminOnly>
  );
}
