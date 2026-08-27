import { NextResponse } from 'next/server';
import { requireQualityRiskParticipant, qualityRiskActor } from '@/lib/quality-risk-access';
import { prisma } from '@/lib/prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk, parseInternalQualityRiskInput, updateInternalQualityRiskRecord, expectedInternalQualityRiskVersion } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
const fields = ['occurrenceCause', 'escapeCause', 'systemCause', 'rootCause', 'secondaryCause', 'containmentAction', 'disposition', 'correctiveAction', 'preventiveAction', 'finalConclusion', 'evidenceSummary', 'warningSummary', 'requiredAction', 'inspectionMethod', 'inspectionFrequency', 'acceptanceCriteria', 'stopConditions', 'applicableProcess'] as const;
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireQualityRiskParticipant(params.id, 'manage');
    const body = await req.json();
    const report = await prisma.internalQualityRiskReport.findUniqueOrThrow({ where: { id: params.id }, include: internalQualityRiskInclude });
    const input = parseInternalQualityRiskInput({ ...serializeInternalQualityRisk(report), ...Object.fromEntries(fields.filter(key => key in body).map(key => [key, body[key]])), issueIds: report.issues.map(item => item.issueId), productIds: report.products.map(item => item.drawingLibraryItemId), workOrderIds: report.workOrders.filter(item => item.source !== 'PRODUCT_AUTO').map(item => item.workOrderId), eightDReportIds: report.eightDReports.map(item => item.eightDReportId) });
    const updated = await prisma.$transaction(tx => updateInternalQualityRiskRecord(tx, params.id, input, expectedInternalQualityRiskVersion(body.expectedVersion), qualityRiskActor(user)));
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(updated) });
  } catch (error) { return internalQualityRiskRouteError(error, '处理方案保存失败'); }
}
