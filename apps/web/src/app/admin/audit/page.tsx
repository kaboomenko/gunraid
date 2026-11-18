import { AdminOnly } from '@/components/admin/shell';
import { AdminAudit } from '@/components/admin/records';

export default function Page() {
  return (
    <AdminOnly>
      <AdminAudit />
    </AdminOnly>
  );
}
