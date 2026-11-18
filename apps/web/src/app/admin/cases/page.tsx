import { AdminOnly } from '@/components/admin/shell';
import { AdminCases } from '@/components/admin/cases';

export default function Page() {
  return (
    <AdminOnly>
      <AdminCases />
    </AdminOnly>
  );
}
