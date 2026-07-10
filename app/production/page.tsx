import { redirect } from 'next/navigation';
import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import { currentUser } from '@/lib/auth';

export default async function ProductionPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <ProductionExecutionCenter user={user} />;
}
