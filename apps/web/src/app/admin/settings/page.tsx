import { AdminOnly } from '@/components/admin/shell';
import { AdminSettings } from '@/components/admin/settings';

export default function Page() {
  return (
    <AdminOnly>
      <AdminSettings />
    </AdminOnly>
  );
}
