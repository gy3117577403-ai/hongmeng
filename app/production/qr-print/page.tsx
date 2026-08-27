import WorkOrderTravelerPrint from '@/components/WorkOrderTravelerPrint';
import { requirePageAccess } from '@/lib/page-access';
import {
  loadWorkOrderTravelerPrints,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';
import { sanitizeWorkOrderPrintReturnTo, workOrderPrintReturnLabel } from '@/lib/work-order-print-navigation';
import './traveler-print.css';
import './quality-warning-v2.css';

export const dynamic = 'force-dynamic';

export default async function WorkOrderQrPrintPage({
  searchParams,
}: {
  searchParams?: { printIds?: string | string[]; returnTo?: string | string[] };
}) {
  const value = Array.isArray(searchParams?.printIds) ? searchParams?.printIds[0] : searchParams?.printIds;
  const returnTo = sanitizeWorkOrderPrintReturnTo(searchParams?.returnTo);
  const query = new URLSearchParams({ printIds: value || '', returnTo });
  await requirePageAccess('/production/qr-print', `/production/qr-print?${query.toString()}`);
  try {
    const records = await loadWorkOrderTravelerPrints(String(value || '').split(','));
    return <WorkOrderTravelerPrint records={records} returnTo={returnTo} />;
  } catch (error) {
    const message = error instanceof WorkOrderQrServiceError ? error.message : '流转单加载失败';
    return <main className="traveler-print-error"><strong>无法打开流转单</strong><p>{message}</p><a href={returnTo}>{workOrderPrintReturnLabel(returnTo)}</a></main>;
  }
}
