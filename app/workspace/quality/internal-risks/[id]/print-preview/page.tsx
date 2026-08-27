import InternalQualityRiskPrintPreview from '@/components/InternalQualityRiskPrintPreview';
import { loadInternalQualityRiskPrintPreview } from '@/lib/internal-quality-risks';
import { requirePageAccess } from '@/lib/page-access';
import type { InternalQualityRiskPrintPreviewDTO } from '@/types';
import '@/app/production/qr-print/traveler-print.css';
import './print-preview.css';

export const dynamic = 'force-dynamic';

export default async function InternalQualityRiskPrintPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { workOrderId?: string | string[] };
}) {
  const workOrderId = Array.isArray(searchParams?.workOrderId) ? searchParams?.workOrderId[0] : searchParams?.workOrderId;
  const next = `/workspace/quality/internal-risks/${encodeURIComponent(params.id)}/print-preview${workOrderId ? `?workOrderId=${encodeURIComponent(workOrderId)}` : ''}`;
  await requirePageAccess('/workspace/quality/internal-risks', next);
  const preview = await loadInternalQualityRiskPrintPreview(params.id, workOrderId || '');
  return <InternalQualityRiskPrintPreview preview={preview as InternalQualityRiskPrintPreviewDTO} />;
}
