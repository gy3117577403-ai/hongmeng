import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import { parseAttendanceEmployeeIds, parseWorkDate } from '@/lib/attendance';
import { requireAttendanceWorkday } from '@/lib/attendance-calendar-service';
import { attendanceGroupEmployeeWhere, parseOptionalAttendanceGroup } from '@/lib/attendance-groups';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { employeePolicyOnDate } from '@/lib/employee-attainment-policy-service';
import { attendancePolicySnapshot, policyFromAttendance } from '@/lib/employee-attainment-policy';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
  employeeHiredOnOrBeforeWhere,
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
    await requireAttendanceWorkday(workDate.key);
    const requestedScope: AttendanceWorkforceScope = body.scope
      ? parseAttendanceWorkforceScope(body.scope)
      : 'ALL';
    const boundary = await resolveAttendanceAccessBoundary(user);
    const scope = effectiveAttendanceWorkforceScope(boundary, requestedScope);
    const attendanceGroup = parseOptionalAttendanceGroup(body.attendanceGroup);
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
        ...attendanceGroupEmployeeWhere(attendanceGroup),
        AND: [employeeHiredOnOrBeforeWhere(workDate.value)],
        ...(boundary.employeeIds === null ? {} : { id: { in: boundary.employeeIds } }),
        ...(requestedEmployeeIds.length ? { id: { in: requestedEmployeeIds } } : {}),
      },
      select: {
        id: true,
        attainmentEligible: true,
        attainmentFactorBasisPoints: true,
        attainmentStream: true,
        attendanceGroup: true,
      },
    });
    if (requestedEmployeeIds.length && employees.length !== requestedEmployeeIds.length) {
      return NextResponse.json({ ok: false, error: '所选员工不在当前考勤范围，请刷新列表后重试' }, { status: 409 });
    }
    if (!employees.length) return NextResponse.json({ ok: false, error: '没有可确认考勤的在用员工' }, { status: 400 });
    const employeeIds = employees.map(employee => employee.id);
    const existingRecords = await prisma.attendanceRecord.findMany({
      where: {
        workDate: workDate.value,
        employeeId: { in: employeeIds },
        ...attendanceRecordScopeWhere(scope),
      },
      select: {
        id: true,
        employeeId: true,
        status: true,
        attainmentEligibleSnapshot: true,
        attainmentFactorBasisPointsSnapshot: true,
        attainmentStreamSnapshot: true,
        attendanceGroupSnapshot: true,
      },
    });
    const draftRecords = existingRecords.filter(record => record.status === 'draft');
    const draftIds = draftRecords.map(record => record.employeeId);
    const confirmedIds = new Set(existingRecords.filter(record => record.status === 'confirmed').map(record => record.employeeId));
    const recordIds = new Set(existingRecords.map(record => record.employeeId));
    const missingIds = employeeIds.filter(employeeId => !recordIds.has(employeeId));
    const now = new Date();
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    const confirmedRecords = draftRecords.length
      ? await prisma.$transaction(async tx => {
        const result: Array<{ id: string }> = [];
        for (const selected of [...draftRecords].sort((a, b) => a.employeeId.localeCompare(b.employeeId))) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-work:' + selected.employeeId}))`;
          const record = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: selected.id } });
          if (record.status !== 'draft') continue;
          const employee = await tx.employee.findUniqueOrThrow({ where: { id: record.employeeId } });
          const dated = await employeePolicyOnDate(tx, employee, workDate.value);
          const policy = dated.effectiveDate && !record.attainmentPolicyOverride ? dated.policy : policyFromAttendance(record, dated.policy);
          result.push(await tx.attendanceRecord.update({
            where: { id: record.id },
            data: {
              status: 'confirmed',
              confirmedById: user.id,
              confirmedAt: now,
              updatedById: user.id,
              ...attendancePolicySnapshot(policy),
            },
            select: { id: true },
          }));
        }
        return result;
      }, { timeout: 20000 })
      : [];
    await logOp({
      userId: user.id,
      action: 'batch_confirm_attendance',
      targetType: 'attendance_record',
      detail: {
        workDate: workDate.key,
        scope,
        attendanceGroup,
        requestedCount: employeeIds.length,
        confirmedCount: confirmedRecords.length,
        alreadyConfirmedCount: confirmedIds.size,
        missingCount: missingIds.length,
      },
    });
    return NextResponse.json({
      ok: true,
      requestedCount: employeeIds.length,
      confirmedCount: confirmedRecords.length,
      skippedCount: employeeIds.length - confirmedRecords.length,
      alreadyConfirmedCount: confirmedIds.size,
      missingCount: missingIds.length,
      items: employeeIds.map(employeeId => ({
        employeeId,
        status: draftIds.includes(employeeId)
          ? 'confirmed'
          : confirmedIds.has(employeeId)
            ? 'already_confirmed'
            : 'missing',
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '批量确认考勤失败';
    console.error('batch confirm attendance failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
