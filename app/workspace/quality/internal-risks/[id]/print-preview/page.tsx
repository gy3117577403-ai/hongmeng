import InternalQualityRiskPrintPreview from '@/components/InternalQualityRiskPrintPreview';
import { loadInternalQualityRiskPrintPreview } from '@/lib/internal-quality-risks';
import { requirePageAccess } from '@/lib/page-access';
import type { InternalQualityRiskPrintPreviewDTO } from '@/types';
import { PrintableDocumentError } from '@/lib/printable-document';
import Link from 'next/link';
import '@/app/production/qr-print/traveler-print.css';
import './print-preview.css';
import '@/app/production/qr-print/quality-warning-v2.css';

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
  try {
    const preview = await loadInternalQualityRiskPrintPreview(params.id, workOrderId || '');
    return <InternalQualityRiskPrintPreview preview={preview as InternalQualityRiskPrintPreviewDTO} />;
  } catch (error) {
    if (!(error instanceof PrintableDocumentError)) throw error;
    return <main className="risk-print-preview-screen"><section className="risk-print-preview-notice draft" role="alert"><div><h1>暂时无法生成完整打印预览</h1><p>{error.message}</p><Link href={`/workspace/quality/internal-risks?reportId=${encodeURIComponent(params.id)}`}>返回异常工作台</Link><p>修复文件读取后可重新预览；不会生成缺图的正式附页。</p></div></section></main>;
  }
}
