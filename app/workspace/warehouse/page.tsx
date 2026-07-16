import { redirect } from 'next/navigation';
import WarehouseManagementShell from '@/components/WarehouseManagementShell';
import { currentUser } from '@/lib/auth';
import './warehouse-workbench.css';

export default async function WarehouseManagementPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=%2Fworkspace%2Fwarehouse');
  return <WarehouseManagementShell user={user} />;
}
