import { NextRequest, NextResponse } from 'next/server';
import { qualityRiskSession } from '@/lib/quality-risk-access';
import { prisma } from '@/lib/prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { qualityWorkflowPeople } from '@/lib/quality-workflow-v3';
import { qualityNotificationBatchReportIds } from '@/lib/quality-notification-links';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await qualityRiskSession();
    const batchIds = await qualityNotificationBatchReportIds(req.nextUrl.searchParams.get('batch'), user.id);
    const reports = await prisma.internalQualityRiskReport.findMany({ where: { deletedAt: null, status: { not: 'DRAFT' }, OR: [{ ownerUserId: user.id }, { tasks: { some: { ownerUserId: user.id } } }] }, include: internalQualityRiskInclude, orderBy: { updatedAt: 'desc' }, take: 300 });
    const linkId = req.nextUrl.searchParams.get('reportId');
    if (linkId && !reports.some(item => item.id === linkId)) { const linked = await prisma.internalQualityRiskReport.findFirst({ where: { id: linkId, deletedAt: null, status: { not: 'DRAFT' }, OR: [{ ownerUserId: user.id }, { tasks: { some: { ownerUserId: user.id } } }] }, include: internalQualityRiskInclude }); if (linked) reports.unshift(linked); }
    const assignees = await qualityWorkflowPeople();
    const missingIds = batchIds.filter(id => !reports.some(report => report.id === id));
    if (missingIds.length) reports.unshift(...await prisma.internalQualityRiskReport.findMany({ where: {
      id: { in: missingIds }, deletedAt: null, status: { not: 'DRAFT' },
      OR: [{ ownerUserId: user.id }, { tasks: { some: { ownerUserId: user.id } } }],
    }, include: internalQualityRiskInclude }));
    return NextResponse.json({ ok: true, reports: reports.map(serializeInternalQualityRisk), assignees });
  } catch (error) { return internalQualityRiskRouteError(error, '我的质量任务加载失败'); }
}
