import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sampleMemberScore(employee: { team: string | null; position: string | null }) {
  const text = `${employee.team || ''} ${employee.position || ''}`;
  return /样品/.test(text) ? 1 : 0;
}

export async function GET() {
  try {
    const user = await requireUser();
    const managementModules = new Set(['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS']);
    const captureOnly = user.access.modules.includes('FIELD_REPORT')
      && !user.access.modules.some(module => managementModules.has(module));
    if (captureOnly) {
      const processes = await prisma.processDefinition.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return NextResponse.json({ ok: true, members: [], sampleMemberCount: 0, products: [], processes });
    }
    const [employees, products, processes] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true, resignedAt: null },
        select: { id: true, employeeNo: true, name: true, team: true, position: true, department: true },
        orderBy: [{ employeeNo: 'asc' }],
        take: 1000,
      }),
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        select: { id: true, customerName: true, productName: true, specification: true, libraryKey: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: 600,
      }),
      prisma.processDefinition.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const members = employees
      .map(employee => ({ ...employee, sampleTeam: sampleMemberScore(employee) === 1 }))
      .sort((a, b) => Number(b.sampleTeam) - Number(a.sampleTeam) || a.employeeNo.localeCompare(b.employeeNo, 'zh-CN'));
    return NextResponse.json({
      ok: true,
      members,
      sampleMemberCount: members.filter(item => item.sampleTeam).length,
      products,
      processes,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample team context failed', error);
    return NextResponse.json({ ok: false, error: '样品组基础资料加载失败' }, { status: 500 });
  }
}
