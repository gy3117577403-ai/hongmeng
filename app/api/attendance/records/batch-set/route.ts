import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import {
  attendanceTotals,
  defaultAttendanceSegments,
  parseAttendanceSegments,
  parseAttendanceType,
  parseAttendanceEmployeeIds,
  parseWorkDate,
  STANDARD_DAY_MILLISECONDS,
} from '@/lib/attendance';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceEmployeeWhere,
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
    const employeeIds = parseAttendanceEmployeeIds(body.employeeIds);
    const requestedScope: AttendanceWorkforceScope = body.scope
      ? parseAttendanceWorkforceScope(body.scope)
      : 'ALL';
    const boundary = await resolveAttendanceAccessBoundary(user);
    const scope = effectiveAttendanceWorkforceScope(boundary, requestedScope);
    if (
      boundary.employeeIds !== null
      && employeeIds.some(employeeId => !boundary.employeeIds!.includes(employeeId))
    ) {
      return NextResponse.json({ ok: false, error: '批量范围包含无权管理的员工' }, { status: 403 });
    }
    const employees = await prisma.employee.findMany({
      where: {
        ...attendanceEmployeeWhere(scope),
        ...(boundary.employeeIds === null ? {} : { id: { in: boundary.employeeIds } }),
        id: { in: employeeIds },
      },
      select: { id: true, department: true, team: true, position: true, attainmentEligible: true },
    });
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '所选员工不在当前考勤范围，请刷新列表后重试' }, { status: 409 });
    }

    const attendanceType = parseAttendanceType(body.attendanceType);
    const segments = body.segments === undefined
      ? attendanceType === 'normal' ? defaultAttendanceSegments(workDate.key) : []
      : parseAttendanceSegments(body.segments, workDate.key);
    if (attendanceType === 'normal' && !segments.length) {
      return NextResponse.json({ ok: false, error: '正常出勤至少需要一个有效时段' }, { status: 400 });
    }
    const totals = attendanceTotals({ attendanceType, segments, leaveMinutes: body.leaveMinutes });
    const existing = await prisma.attendanceRecord.findMany({
      where: { workDate: workDate.value, employeeId: { in: employeeIds } },
      select: { employeeId: true, status: true },
    });
    const confirmedIds = new Set(existing.filter(record => record.status === 'confirmed').map(record => record.employeeId));
    const writable = employees.filter(employee => !confirmedIds.has(employee.id));
    const remark = cleanProcessText(body.remark, 500) || null;

    if (writable.length) {
      await prisma.$transaction(writable.map(employee => prisma.attendanceRecord.upsert({
        where: { employeeId_workDate: { employeeId: employee.id, workDate: workDate.value } },
        create: {
          employeeId: employee.id,
          departmentSnapshot: normalizeEmployeeDepartment(employee.department) || '',
          teamSnapshot: employee.team,
          positionSnapshot: employee.position,
          attainmentEligibleSnapshot: employee.attainmentEligible,
          workDate: workDate.value,
          status: 'draft',
          attendanceType,
          plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
          ...totals,
          segments: segments as unknown as Prisma.InputJsonValue,
          source: 'manual_batch',
          remark,
          createdById: user.id,
          updatedById: user.id,
        },
        update: {
          status: 'draft',
          attendanceType,
          plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
          ...totals,
          segments: segments as unknown as Prisma.InputJsonValue,
          source: 'manual_batch',
          remark,
          updatedById: user.id,
          confirmedById: null,
          confirmedAt: null,
        },
      })));
    }
    await logOp({
      userId: user.id,
      action: 'batch_set_attendance',
      targetType: 'attendance_record',
      detail: {
        workDate: workDate.key,
        scope,
        attendanceType,
        requestedCount: employeeIds.length,
        savedCount: writable.length,
        skippedConfirmedCount: confirmedIds.size,
      },
    });
    return NextResponse.json({
      ok: true,
      requestedCount: employeeIds.length,
      savedCount: writable.length,
      skippedCount: confirmedIds.size,
      items: employeeIds.map(employeeId => ({
        employeeId,
        status: confirmedIds.has(employeeId) ? 'confirmed_skipped' : 'saved_draft',
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '批量设置考勤失败';
    console.error('batch set attendance failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
