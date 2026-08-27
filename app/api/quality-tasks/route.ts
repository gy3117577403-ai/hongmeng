import { NextResponse } from 'next/server';
import { qualityRiskSession } from '@/lib/quality-risk-access';
import { prisma } from '@/lib/prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from '@/lib/internal-quality-risks';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await qualityRiskSession();
    const reports = await prisma.internalQualityRiskReport.findMany({ where: { deletedAt: null, status: { not: 'DRAFT' }, OR: [{ ownerUserId: user.id }, { tasks: { some: { ownerUserId: user.id } } }] }, include: internalQualityRiskInclude, orderBy: { updatedAt: 'desc' }, take: 300 });
    const assignees = await prisma.user.findMany({ where: { isActive: true, accountStatus: 'ACTIVE', fieldPasswordOnly: false }, select: { id: true, displayName: true, username: true }, orderBy: { displayName: 'asc' } });
    return NextResponse.json({ ok: true, reports: reports.map(serializeInternalQualityRisk), assignees });
  } catch (error) { return internalQualityRiskRouteError(error, '我的质量任务加载失败'); }
}
