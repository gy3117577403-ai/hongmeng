import { NextResponse } from 'next/server';
import { ForbiddenError, requireCapability, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireCapability('QUALITY', 'UPDATE');
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        department: true,
        position: true,
        team: true,
        isActive: true,
        departmentRef: { select: { name: true } },
      },
      orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json({
      ok: true,
      employees: employees.map(employee => ({
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: employee.name,
        department: employee.departmentRef?.name || employee.department,
        position: employee.position,
        team: employee.team,
        isActive: employee.isActive,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('issue assignee options failed', error);
    return NextResponse.json({ ok: false, error: '问题负责人列表加载失败' }, { status: 500 });
  }
}
