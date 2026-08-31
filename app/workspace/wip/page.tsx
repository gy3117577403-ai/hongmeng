import WipWarehouseShell from '@/components/WipWarehouseShell';
import { requirePageAccess } from '@/lib/page-access';
import './wip-workbench.css';

export default async function WipWarehousePage({
  searchParams,
}: {
  searchParams?: { batchId?: string | string[] };
}) {
  const user = await requirePageAccess('/workspace/wip');
  const batchId = Array.isArray(searchParams?.batchId) ? searchParams?.batchId[0] : searchParams?.batchId;
  return <WipWarehouseShell user={user} initialBatchId={batchId || ''} />;
}
