import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import { loadInternalQualityRiskOptions } from '@/lib/internal-quality-risks';
import { qualityWorkflowPeople } from '@/lib/quality-workflow-v3';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireUser();
    if (new URL(req.url).searchParams.get('peopleOnly') === '1') {
      const employees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true, employeeNo: true, department: true, team: true }, orderBy: { employeeNo: 'asc' } });
      return NextResponse.json({ ok: true, employees }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.json({ ok: true, ...(await loadInternalQualityRiskOptions()), assignees: await qualityWorkflowPeople() });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常关联选项加载失败');
  }
}
