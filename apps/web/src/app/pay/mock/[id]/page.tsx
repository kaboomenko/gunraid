import type { Metadata } from 'next';
import { MockPay } from './mock-pay';

export const metadata: Metadata = { title: 'Mock payment', robots: { index: false } };

export default async function MockPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MockPay id={id} />;
}
