'use client';

import { useMe } from '@/lib/me';
import { AdminDashboard } from './dashboard';
import { AdminUsers } from './users';

/** Admin видит дашборд, support — сразу пользователей. */
export function AdminLanding() {
  const me = useMe();
  return me.data?.role === 'admin' ? <AdminDashboard /> : <AdminUsers />;
}
