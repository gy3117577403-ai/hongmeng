import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export default async function TimeStandardsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Ftime-standards');
  redirect('/workspace/product-times');
}
