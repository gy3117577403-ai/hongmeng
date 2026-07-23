import { redirect } from 'next/navigation';
import ProductionExecutionCenter from '@/components/ProductionExecutionCenter';
import { currentUser } from '@/lib/auth';
import './production-workbench.css';

export default async function ProductionPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.laborRole === 'EMPLOYEE') redirect('/workspace/reports?view=labor');
  return <ProductionExecutionCenter user={user} />;
}
