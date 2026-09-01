import WipWarehouseShell from '@/components/WipWarehouseShell';
import { requirePageAccess } from '@/lib/page-access';
import './wip-workbench.css';

export default async function WipWarehousePage({
  searchParams,
}: {
  searchParams?: {
    batchId?: string | string[];
    view?: string | string[];
    week?: string | string[];
    allocationId?: string | string[];
  };
}) {
  const user = await requirePageAccess('/workspace/wip');
  const batchId = Array.isArray(searchParams?.batchId) ? searchParams?.batchId[0] : searchParams?.batchId;
  const view = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const week = Array.isArray(searchParams?.week) ? searchParams?.week[0] : searchParams?.week;
  const allocationId = Array.isArray(searchParams?.allocationId) ? searchParams?.allocationId[0] : searchParams?.allocationId;
  return <WipWarehouseShell
    user={user}
    initialBatchId={batchId || ''}
    initialView={view || 'all'}
    initialWeekStartDate={week || ''}
    initialAllocationId={allocationId || ''}
  />;
}
