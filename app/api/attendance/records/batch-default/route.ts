import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import {
  defaultAttendanceSegments,
  parseAttendanceEmployeeIds,
  parseWorkDate,
  STANDARD_DAY_MILLISECONDS,
} from '@/lib/attendance';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceEmployeeWhere,
  employeeHiredOnOrBeforeWhere,
  normalizeEmployeeDepartment,
  parseAttendanceWorkforceScope,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workDate = parseWorkDate(body.workDate);
    const requestedScope: AttendanceWorkforceScope = body.scope
      ? parseAttendanceWorkforceScope(body.scope)
      : 'ALL';
    const boundary = await resolveAttendanceAccessBoundary(user);
    const scope = effectiveAttendanceWorkforceScope(boundary, requestedScope);
    const requestedEmployeeIds = body.employeeIds === undefined ? [] : parseAttendanceEmployeeIds(body.employeeIds);
    if (
      boundary.employeeIds !== null
      && requestedEmployeeIds.some(employeeId => !boundary.employeeIds!.includes(employeeId))
    ) {
      return NextResponse.json({ ok: false, error: '批量范围包含无权管理的员工' }, { status: 403 });
    }
    const employees = await prisma.employee.findMany({
      where: {
        ...attendanceEmployeeWhere(scope),
        AND: [employeeHiredOnOrBeforeWhere(workDate.value)],
        ...(boundary.employeeIds === null ? {} : { id: { in: boundary.employeeIds } }),
        ...(requestedEmployeeIds.length ? { id: { in: requestedEmployeeIds } } : {}),
      },
      select: {
        id: true,
        department: true,
        team: true,
        position: true,
        attainmentEligible: true,
        attainmentFactorBasisPoints: true,
        attainmentStream: true,
      },
    });
    if (requestedEmployeeIds.length && employees.length !== requestedEmployeeIds.length) {
      return NextResponse.json({ ok: false, error: '所选员工不在当前考勤范围，请刷新列表后重试' }, { status: 409 });
    }
    if (!employees.length) return NextResponse.json({ ok: false, error: '没有可生成考勤的在用员工' }, { status: 400 });
    const segments = defaultAttendanceSegments(workDate.key);
    const result = await prisma.attendanceRecord.createMany({
      data: employees.map(employee => ({
        employeeId: employee.id,
        departmentSnapshot: normalizeEmployeeDepartment(employee.department) || '',
        teamSnapshot: employee.team,
        positionSnapshot: employee.position,
        attainmentEligibleSnapshot: employee.attainmentEligible,
        attainmentFactorBasisPointsSnapshot: employee.attainmentFactorBasisPoints,
        attainmentStreamSnapshot: employee.attainmentStream,
        workDate: workDate.value,
        status: 'draft',
        attendanceType: 'normal',
        plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
        leaveMilliseconds: 0,
        actualMilliseconds: STANDARD_DAY_MILLISECONDS,
        overtimeMilliseconds: 0,
        segments: segments as unknown as Prisma.InputJsonValue,
        source: 'manual_default',
        createdById: user.id,
        updatedById: user.id,
      })),
      skipDuplicates: true,
    });
    await logOp({
      userId: user.id,
      action: 'batch_create_default_attendance',
      targetType: 'attendance_record',
      detail: { workDate: workDate.key, scope, requested: employees.length, created: result.count },
    });
    return NextResponse.json({
      ok: true,
      requestedCount: employees.length,
      createdCount: result.count,
      skippedCount: employees.length - result.count,
      items: employees.map(employee => ({ employeeId: employee.id })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '批量生成考勤失败';
    console.error('batch attendance failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
