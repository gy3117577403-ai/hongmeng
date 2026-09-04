import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { resolveAttendanceAccessBoundary } from '@/lib/attendance-access';
import { chinaTodayDateKey, parseWorkDate } from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { employeeHiredOnOrBeforeWhere } from '@/lib/production-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const boundary = await resolveAttendanceAccessBoundary(user);
    const workDate = parseWorkDate(req.nextUrl.searchParams.get('date') || chinaTodayDateKey());
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        attendanceEnabled: true,
        AND: [employeeHiredOnOrBeforeWhere(workDate.value)],
        ...(boundary.employeeIds === null ? {} : { id: { in: boundary.employeeIds } }),
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        department: true,
        departmentId: true,
        position: true,
        team: true,
        hireDate: true,
        isActive: true,
        attendanceEnabled: true,
        attendanceGroup: true,
        attainmentEligible: true,
        attainmentFactorBasisPoints: true,
        attainmentStream: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { employeeNo: 'asc' },
    });
    return NextResponse.json({
      ok: true,
      employees: employees.map(employee => ({
        ...employee,
        hireDate: employee.hireDate?.toISOString() || null,
        mobile: null,
        wecomUserId: null,
        notificationEnabled: false,
        resignedAt: null,
        resignationReason: null,
        resignationNote: null,
        createdAt: employee.createdAt.toISOString(),
        updatedAt: employee.updatedAt.toISOString(),
      })),
      permissions: {
        allowedWorkforceScopes: boundary.allowedWorkforceScopes,
        scopeLabel: boundary.scopeLabel,
        unrestricted: boundary.unrestricted,
      },
      effectiveDate: workDate.key,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('attendance employee directory failed', error);
    return NextResponse.json({ ok: false, error: '考勤员工目录加载失败' }, { status: 500 });
  }
}
