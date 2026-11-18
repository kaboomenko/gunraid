import type { Metadata } from 'next';
import { AdminHome } from './admin-home';

export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

export default function AdminPage() {
  return <AdminHome />;
}
