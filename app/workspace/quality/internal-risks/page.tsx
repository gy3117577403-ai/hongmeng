import InternalQualityRiskShell from '@/components/InternalQualityRiskShell';
import { requirePageAccess } from '@/lib/page-access';
import './internal-quality-risk.css';

export default async function InternalQualityRiskPage({ searchParams }: { searchParams?: { reportId?: string | string[]; workOrderId?: string | string[] } }) {
  const user = await requirePageAccess('/workspace/quality/internal-risks');
  const reportId = Array.isArray(searchParams?.reportId) ? searchParams?.reportId[0] : searchParams?.reportId;
  const workOrderId = Array.isArray(searchParams?.workOrderId) ? searchParams?.workOrderId[0] : searchParams?.workOrderId;
  return <InternalQualityRiskShell user={user} initialReportId={reportId || ''} initialWorkOrderId={workOrderId || ''} />;
}
