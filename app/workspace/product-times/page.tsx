import { redirect } from 'next/navigation';
import ProductTimeShell from '@/components/ProductTimeShell';
import { currentUser } from '@/lib/auth';
import './product-time-workbench.css';

export default async function ProductTimesPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fproduct-times');
  return <ProductTimeShell user={user} />;
}
