import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';

export default async function TimeStandardsPage() {
  await requirePageAccess('/workspace/time-standards');
  redirect('/workspace/product-times');
}
