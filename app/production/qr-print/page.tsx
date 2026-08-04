import { redirect } from 'next/navigation';
import WorkOrderTravelerPrint from '@/components/WorkOrderTravelerPrint';
import { currentUser } from '@/lib/auth';
import {
  loadWorkOrderTravelerPrints,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';
import './traveler-print.css';

export const dynamic = 'force-dynamic';

export default async function WorkOrderQrPrintPage({
  searchParams,
}: {
  searchParams?: { printIds?: string | string[] };
}) {
  const user = await currentUser();
  const value = Array.isArray(searchParams?.printIds) ? searchParams?.printIds[0] : searchParams?.printIds;
  if (!user) {
    const next = `/production/qr-print?printIds=${encodeURIComponent(value || '')}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  try {
    const records = await loadWorkOrderTravelerPrints(String(value || '').split(','));
    return <WorkOrderTravelerPrint records={records} />;
  } catch (error) {
    const message = error instanceof WorkOrderQrServiceError ? error.message : '流转单加载失败';
    return <main className="traveler-print-error"><strong>无法打开流转单</strong><p>{message}</p><a href="/production">返回生产执行</a></main>;
  }
}
