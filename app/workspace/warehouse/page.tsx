import WarehouseManagementShell from '@/components/WarehouseManagementShell';
import { requirePageAccess } from '@/lib/page-access';
import './warehouse-workbench.css';

export default async function WarehouseManagementPage() {
  const user = await requirePageAccess('/workspace/warehouse');
  return <WarehouseManagementShell user={user} />;
}
