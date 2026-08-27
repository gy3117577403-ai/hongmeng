import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { qualityWorkflowPeople } from '@/lib/quality-workflow-v3';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await requireCapability('QUALITY', 'EXECUTE_WORKFLOW');
    const reports = await prisma.internalQualityRiskReport.findMany({ where: { reviewerUserId: user.id, deletedAt: null, reviewRound: { gt: 0 } }, include: internalQualityRiskInclude, orderBy: { updatedAt: 'desc' }, take: 300 });
    return NextResponse.json({ ok: true, reports: reports.map(serializeInternalQualityRisk), assignees: await qualityWorkflowPeople() });
  } catch (error) { return internalQualityRiskRouteError(error, '品质确认加载失败'); }
}
