import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  attendanceEmployeeAllowed,
  departedAttendanceCorrectionError,
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import {
  attendanceRange,
  attendanceTotals,
  attainmentEligibleFromConfiguration,
  defaultAttendanceSegments,
  dateKeyFromDatabase,
  parseAttainmentFactorBasisPoints,
  parseAttainmentStream,
  parseAttendanceSegments,
  parseAttendanceType,
  parseWorkDate,
  serializeAttendanceRecord,
  STANDARD_DAY_MILLISECONDS,
} from '@/lib/attendance';
import { requireAttendanceWorkday } from '@/lib/attendance-calendar-service';
import { attendanceCalendarDayLabel, resolveAttendanceCalendarDay } from '@/lib/attendance-calendar';
import { ATTENDANCE_GROUPS, parseAttendanceGroup } from '@/lib/attendance-groups';
import { cleanProcessText, serializeEmployee } from '@/lib/process-time';
import { hasCapability } from '@/lib/department-access';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  isEmployeeEmployedOnDate,
  normalizeEmployeeDepartment,
  parseAttendanceWorkforceScope,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  employee: true,
  confirmedBy: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.AttendanceRecordInclude;

type AttendanceAuditRecord = Prisma.AttendanceRecordGetPayload<{ include: typeof include }>;

function attendanceAuditSnapshot(record: AttendanceAuditRecord) {
  return {
    status: record.status,
    attendanceType: record.attendanceType,
    plannedMilliseconds: record.plannedMilliseconds,
    leaveMilliseconds: record.leaveMilliseconds,
    actualMilliseconds: record.actualMilliseconds,
    overtimeMilliseconds: record.overtimeMilliseconds,
    segments: record.segments,
    remark: record.remark,
    attainmentEligibleSnapshot: record.attainmentEligibleSnapshot,
    attainmentFactorBasisPointsSnapshot: record.attainmentFactorBasisPointsSnapshot,
    attainmentStreamSnapshot: record.attainmentStreamSnapshot,
    confirmedById: record.confirmedById,
    confirmedAt: record.confirmedAt?.toISOString() || null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const period = req.nextUrl.searchParams.get('period') === 'month'
      ? 'month' as const
      : req.nextUrl.searchParams.get('period') === 'week'
        ? 'week' as const
        : 'today' as const;
    const range = attendanceRange(period, req.nextUrl.searchParams.get('date'));
    const start = parseWorkDate(range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const end = parseWorkDate(range.end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const employeeId = cleanProcessText(req.nextUrl.searchParams.get('employeeId'), 80);
    const requestedScope = req.nextUrl.searchParams.get('scope');
    const parsedScope: AttendanceWorkforceScope = requestedScope
      ? parseAttendanceWorkforceScope(requestedScope)
      : 'ALL';
    const boundary = await resolveAttendanceAccessBoundary(user);
    const scope = effectiveAttendanceWorkforceScope(boundary, parsedScope);
    if (employeeId && !attendanceEmployeeAllowed(boundary, employeeId)) {
      const historicalRecords = await prisma.attendanceRecord.findMany({
        where: {
          employeeId,
          workDate: { gte: start, lt: end },
          AND: [
            attendanceRecordScopeWhere(scope),
            boundary.historicalRecordWhere,
          ],
        },
        include: { employee: true },
      });
      if (!historicalRecords.some(record => isEmployeeEmployedOnDate(
        record.employee,
        dateKeyFromDatabase(record.workDate),
      ))) {
        return NextResponse.json({ ok: false, error: '只能查看本人当前或历史负责范围内的员工考勤' }, { status: 403 });
      }
    }
    const employeeBoundaryWhere = boundary.employeeIds === null
      ? {}
      : { id: { in: boundary.employeeIds } };
    const [records, employees, productionCount, otherCount, allCount, calendarOverrides] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          workDate: { gte: start, lt: end },
          ...(employeeId ? { employeeId } : {}),
          AND: [
            attendanceRecordScopeWhere(scope),
            boundary.historicalRecordWhere,
          ],
        },
        include,
        orderBy: [{ workDate: 'desc' }, { employee: { employeeNo: 'asc' } }],
      }),
      prisma.employee.findMany({
        where: {
          ...attendanceEmployeeWhere(scope),
          AND: [employeeHiredBeforeWhere(end)],
          ...employeeBoundaryWhere,
          ...(employeeId ? { id: employeeId } : {}),
        },
        orderBy: { employeeNo: 'asc' },
      }),
      prisma.employee.count({ where: { ...attendanceEmployeeWhere('PRODUCTION'), AND: [employeeHiredBeforeWhere(end)], ...employeeBoundaryWhere } }),
      prisma.employee.count({ where: { ...attendanceEmployeeWhere('OTHER'), AND: [employeeHiredBeforeWhere(end)], ...employeeBoundaryWhere } }),
      prisma.employee.count({ where: { ...attendanceEmployeeWhere('ALL'), AND: [employeeHiredBeforeWhere(end)], ...employeeBoundaryWhere } }),
      prisma.attendanceCalendarDay.findMany({
        where: { workDate: { gte: start, lt: end } },
        select: { workDate: true, dayType: true, label: true, remark: true },
      }),
    ]);
    const effectiveRecords = records.filter(item => isEmployeeEmployedOnDate(item.employee, dateKeyFromDatabase(item.workDate)));
    const calendarOverrideByDate = new Map(calendarOverrides.map(item => [dateKeyFromDatabase(item.workDate), item]));
    const resolveDay = (dateKey: string) => {
      const override = calendarOverrideByDate.get(dateKey);
      return resolveAttendanceCalendarDay(dateKey, override ? {
        dayType: override.dayType as 'default' | 'holiday' | 'temporary_workday',
        label: override.label,
        remark: override.remark,
      } : null);
    };
    const reportingRecords = effectiveRecords.filter(item => resolveDay(dateKeyFromDatabase(item.workDate)).isWorkday);
    const confirmed = reportingRecords.filter(item => item.status === 'confirmed');
    const rosterById = new Map(employees.map(employee => [employee.id, employee]));
    effectiveRecords.forEach(record => rosterById.set(record.employeeId, record.employee));
    const roster = [...rosterById.values()].sort((left, right) => left.employeeNo.localeCompare(right.employeeNo, 'zh-CN'));
    const groupSnapshotByEmployee = new Map(
      effectiveRecords.map(record => [record.employeeId, record.attendanceGroupSnapshot]),
    );
    const groupCounts = Object.fromEntries(ATTENDANCE_GROUPS.map(group => [group, 0])) as Record<(typeof ATTENDANCE_GROUPS)[number], number>;
    roster.forEach(employee => {
      const group = parseAttendanceGroup(groupSnapshotByEmployee.get(employee.id) ?? employee.attendanceGroup);
      groupCounts[group] += 1;
    });
    const selectedCalendarDay = resolveDay(range.date);
    return NextResponse.json({
      ok: true,
      period,
      scope,
      scopeCounts: { production: productionCount, other: otherCount, all: allCount },
      groupCounts,
      permissions: {
        allowedWorkforceScopes: boundary.allowedWorkforceScopes,
        scopeLabel: boundary.scopeLabel,
        unrestricted: boundary.unrestricted,
      },
      date: range.date,
      calendar: {
        ...selectedCalendarDay,
        displayLabel: attendanceCalendarDayLabel(selectedCalendarDay),
      },
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      employees: roster.map(serializeEmployee),
      records: effectiveRecords.map(serializeAttendanceRecord),
      summary: {
        enabledEmployeeCount: roster.length,
        recordCount: reportingRecords.length,
        confirmedCount: confirmed.length,
        draftCount: reportingRecords.length - confirmed.length,
        actualMilliseconds: confirmed.reduce((sum, item) => sum + item.actualMilliseconds, 0),
        overtimeMilliseconds: confirmed.reduce((sum, item) => sum + item.overtimeMilliseconds, 0),
        leaveMilliseconds: confirmed.reduce((sum, item) => sum + item.leaveMilliseconds, 0),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('attendance records list failed', error);
    return NextResponse.json({ ok: false, error: '考勤记录加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeId = cleanProcessText(body.employeeId, 80);
    if (!employeeId) return NextResponse.json({ ok: false, error: '请选择员工' }, { status: 400 });
    const workDate = parseWorkDate(body.workDate);
    await requireAttendanceWorkday(workDate.key);
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return NextResponse.json({ ok: false, error: '员工档案不存在' }, { status: 404 });
    if (!isEmployeeEmployedOnDate(employee, workDate.key)) {
      const boundaryLabel = employee.hireDate && workDate.key < employee.hireDate.toISOString().slice(0, 10)
        ? `入职日期 ${employee.hireDate.toISOString().slice(0, 10)}`
        : `离职日期 ${employee.resignedAt?.toISOString().slice(0, 10) || '未设置'}`;
      return NextResponse.json({ ok: false, error: `考勤日期不在该员工的在职区间内（${boundaryLabel}）` }, { status: 409 });
    }
    const boundary = await resolveAttendanceAccessBoundary(user);
    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: workDate.value } },
      include,
    });
    const historicalCorrection = !employee.isActive;
    const correctionReason = cleanProcessText(body.correctionReason, 500);
    if (historicalCorrection) {
      const correctionError = departedAttendanceCorrectionError({
        hasHrUpdate: hasCapability(user.access, 'HR', 'UPDATE'),
        existingRecord: Boolean(existing),
        correctionReason,
      });
      if (correctionError) {
        return NextResponse.json({ ok: false, error: correctionError.error }, { status: correctionError.status });
      }
    } else {
      if (!attendanceEmployeeAllowed(boundary, employeeId)) {
        return NextResponse.json({ ok: false, error: '只能登记本人负责范围内的员工考勤' }, { status: 403 });
      }
      if (!employee.attendanceEnabled) {
        return NextResponse.json({ ok: false, error: '该员工未启用考勤' }, { status: 400 });
      }
    }
    const requestedAttendanceType = parseAttendanceType(body.attendanceType);
    const requestedSegments = body.segments === undefined
      ? requestedAttendanceType === 'normal' || requestedAttendanceType === 'partial_leave'
        ? defaultAttendanceSegments(workDate.key)
        : []
      : parseAttendanceSegments(body.segments, workDate.key);
    if ((requestedAttendanceType === 'normal' || requestedAttendanceType === 'partial_leave') && !requestedSegments.length) {
      return NextResponse.json({ ok: false, error: '出勤或部分请假至少需要一个有效班次' }, { status: 400 });
    }
    const totals = attendanceTotals({ attendanceType: requestedAttendanceType, segments: requestedSegments, leaveMinutes: body.leaveMinutes });
    const attendanceType = requestedAttendanceType === 'normal' && totals.leaveMilliseconds > 0
      ? 'partial_leave'
      : requestedAttendanceType;
    const attainmentStream = parseAttainmentStream(body.attainmentStream, parseAttainmentStream(employee.attainmentStream));
    const attainmentFactorBasisPoints = attainmentStream === 'excluded'
      ? 0
      : parseAttainmentFactorBasisPoints(body.attainmentFactorBasisPoints, employee.attainmentFactorBasisPoints);
    const attainmentEligible = attainmentEligibleFromConfiguration(attainmentFactorBasisPoints, attainmentStream);
    const confirm = body.confirm === true;
    const now = new Date();
    const upsertArgs = {
      where: { employeeId_workDate: { employeeId, workDate: workDate.value } },
      create: {
        employeeId,
        departmentSnapshot: normalizeEmployeeDepartment(employee.department) || '',
        teamSnapshot: employee.team,
        positionSnapshot: employee.position,
        attendanceGroupSnapshot: employee.attendanceGroup,
        attainmentEligibleSnapshot: attainmentEligible,
        attainmentFactorBasisPointsSnapshot: attainmentFactorBasisPoints,
        attainmentStreamSnapshot: attainmentStream,
        workDate: workDate.value,
        status: confirm ? 'confirmed' : 'draft',
        attendanceType,
        plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
        ...totals,
        segments: requestedSegments as unknown as Prisma.InputJsonValue,
        remark: cleanProcessText(body.remark, 500) || null,
        createdById: user.id,
        updatedById: user.id,
        confirmedById: confirm ? user.id : null,
        confirmedAt: confirm ? now : null,
      },
      update: {
        status: confirm ? 'confirmed' : 'draft',
        attainmentEligibleSnapshot: attainmentEligible,
        attainmentFactorBasisPointsSnapshot: attainmentFactorBasisPoints,
        attainmentStreamSnapshot: attainmentStream,
        attendanceType,
        plannedMilliseconds: STANDARD_DAY_MILLISECONDS,
        ...totals,
        segments: requestedSegments as unknown as Prisma.InputJsonValue,
        remark: cleanProcessText(body.remark, 500) || null,
        updatedById: user.id,
        confirmedById: confirm ? user.id : null,
        confirmedAt: confirm ? now : null,
      },
      include,
    } satisfies Prisma.AttendanceRecordUpsertArgs;
    const record = historicalCorrection
      ? await prisma.$transaction(async tx => {
        const corrected = await tx.attendanceRecord.upsert(upsertArgs);
        await tx.operationLog.create({
          data: {
            userId: user.id,
            action: 'correct_departed_employee_attendance',
            targetType: 'attendance_record',
            targetId: corrected.id,
            detail: {
              employeeId,
              workDate: workDate.key,
              correctionReason,
              before: attendanceAuditSnapshot(existing!),
              after: attendanceAuditSnapshot(corrected),
            },
          },
        });
        return corrected;
      })
      : await prisma.attendanceRecord.upsert(upsertArgs);
    if (!historicalCorrection) {
      await logOp({
        userId: user.id,
        action: confirm ? 'confirm_attendance_record' : 'save_attendance_record',
        targetType: 'attendance_record',
        targetId: record.id,
        detail: { employeeId, workDate: workDate.key, attendanceType, attainmentFactorBasisPoints, attainmentStream },
      });
    }
    return NextResponse.json({ ok: true, record: serializeAttendanceRecord(record) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '考勤记录保存失败';
    console.error('save attendance record failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
