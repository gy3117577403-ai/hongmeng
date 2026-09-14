import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { qualityWorkflowPeople } from '@/lib/quality-workflow-v3';
import { qualityNotificationBatchReportIds } from '@/lib/quality-notification-links';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireCapability('QUALITY', 'EXECUTE_WORKFLOW');
    const batchIds = await qualityNotificationBatchReportIds(req.nextUrl.searchParams.get('batch'), user.id);
    const reports = await prisma.internalQualityRiskReport.findMany({ where: { reviewerUserId: user.id, deletedAt: null, reviewRound: { gt: 0 } }, include: internalQualityRiskInclude, orderBy: { updatedAt: 'desc' }, take: 300 });
    const linkId = req.nextUrl.searchParams.get('reportId');
    if (linkId && !reports.some(item => item.id === linkId)) { const linked = await prisma.internalQualityRiskReport.findFirst({ where: { id: linkId, reviewerUserId: user.id, deletedAt: null, reviewRound: { gt: 0 } }, include: internalQualityRiskInclude }); if (linked) reports.unshift(linked); }
    const missingIds = batchIds.filter(id => !reports.some(report => report.id === id));
    if (missingIds.length) reports.unshift(...await prisma.internalQualityRiskReport.findMany({ where: {
      id: { in: missingIds }, reviewerUserId: user.id, deletedAt: null, reviewRound: { gt: 0 },
    }, include: internalQualityRiskInclude }));
    return NextResponse.json({ ok: true, reports: reports.map(serializeInternalQualityRisk), assignees: await qualityWorkflowPeople() });
  } catch (error) { return internalQualityRiskRouteError(error, '品质确认加载失败'); }
}
