import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import { createAttendanceWorkbook } from '@/lib/attendance-workbook';
import { dateKeyFromDatabase, parseAttendanceEmployeeIds, parseWorkDate } from '@/lib/attendance';
import { resolveAttendanceCalendarDay } from '@/lib/attendance-calendar';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  isEmployeeHiredOnDate,
  parseAttendanceWorkforceScope,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';
import { reportDateRange, reportRangeDateKeys } from '@/lib/report-date-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    const range = reportDateRange({
      period: req.nextUrl.searchParams.get('period'),
      date: req.nextUrl.searchParams.get('date'),
      startDate: req.nextUrl.searchParams.get('startDate'),
      endDate: req.nextUrl.searchParams.get('endDate'),
      fallbackPeriod: 'week',
    });
    const requestedScope: AttendanceWorkforceScope = req.nextUrl.searchParams.get('scope')
      ? parseAttendanceWorkforceScope(req.nextUrl.searchParams.get('scope'))
      : 'ALL';
    const boundary = await resolveAttendanceAccessBoundary(actor);
    const scope = effectiveAttendanceWorkforceScope(boundary, requestedScope);
    const rawEmployeeIds = req.nextUrl.searchParams.get('employeeIds');
    const requestedEmployeeIds = rawEmployeeIds
      ? parseAttendanceEmployeeIds(rawEmployeeIds.split(',').filter(Boolean))
      : [];
    if (boundary.employeeIds !== null && requestedEmployeeIds.some(id => !boundary.employeeIds!.includes(id))) {
      return NextResponse.json({ ok: false, error: '导出范围包含无权查看的员工' }, { status: 403 });
    }
    const startDate = parseWorkDate(range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const endDate = parseWorkDate(range.end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const employeeWhere = {
      ...attendanceEmployeeWhere(scope),
      AND: [employeeHiredBeforeWhere(endDate)],
      ...(boundary.employeeIds === null ? {} : { id: { in: boundary.employeeIds } }),
      ...(requestedEmployeeIds.length ? { id: { in: requestedEmployeeIds } } : {}),
    };
    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      orderBy: [{ team: 'asc' }, { employeeNo: 'asc' }],
    });
    if (requestedEmployeeIds.length && employees.length !== requestedEmployeeIds.length) {
      return NextResponse.json({ ok: false, error: '部分员工已不在当前考勤范围，请刷新后重试' }, { status: 409 });
    }
    const employeeIds = employees.map(employee => employee.id);
    const [records, calendarOverrides] = await Promise.all([employeeIds.length ? prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: startDate, lt: endDate },
        ...attendanceRecordScopeWhere(scope),
      },
      orderBy: [{ workDate: 'asc' }, { employee: { employeeNo: 'asc' } }],
    }) : Promise.resolve([]), prisma.attendanceCalendarDay.findMany({
      where: { workDate: { gte: startDate, lt: endDate } },
      select: { workDate: true, dayType: true, label: true, remark: true },
    })]);
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    const effectiveRecords = records.filter(record => isEmployeeHiredOnDate(
      employeeById.get(record.employeeId),
      dateKeyFromDatabase(record.workDate),
    ));
    const endInclusive = new Date(range.end.getTime() - 1);
    const rangeEndKey = endInclusive.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const rangeStartKey = range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const dateKeys = reportRangeDateKeys(range.start, range.end);
    const calendarOverrideByDate = new Map(calendarOverrides.map(item => [dateKeyFromDatabase(item.workDate), item]));
    const calendarDays = dateKeys.map(dateKey => {
      const override = calendarOverrideByDate.get(dateKey);
      const day = resolveAttendanceCalendarDay(dateKey, override ? {
        dayType: override.dayType as 'default' | 'holiday' | 'temporary_workday',
        label: override.label,
        remark: override.remark,
      } : null);
      return { dateKey, effectiveDayType: day.effectiveDayType, label: day.label, isWorkday: day.isWorkday };
    });
    const departmentLabels = [...new Set(employees.map(employee => employee.department || '').filter(Boolean))];
    const periodName = range.period === 'week' ? '周度' : range.period === 'month' ? '月度' : '自定义周期';
    const workbook = await createAttendanceWorkbook({
      startDate: rangeStartKey,
      endDate: rangeEndKey,
      periodLabel: `${periodName} · ${rangeStartKey} 至 ${rangeEndKey}`,
      scopeLabel: requestedEmployeeIds.length
        ? `已选 ${employees.length} 人`
        : departmentLabels.length === 1 ? departmentLabels[0] : departmentLabels.length > 1 ? `${departmentLabels.length} 个部门` : scope,
      generatedAt: new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date()).replaceAll('/', '-'),
      employees: employees.map(employee => ({
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: employee.name,
        department: employee.department,
        team: employee.team,
        position: employee.position,
        hireDate: employee.hireDate?.toISOString().slice(0, 10) || null,
      })),
      records: effectiveRecords.map(record => ({
        employeeId: record.employeeId,
        dateKey: dateKeyFromDatabase(record.workDate),
        status: record.status === 'confirmed' ? 'confirmed' : 'draft',
        attendanceType: record.attendanceType === 'leave' ? 'leave' : record.attendanceType === 'absent' ? 'absent' : record.attendanceType === 'rest' ? 'rest' : 'normal',
        plannedMilliseconds: record.plannedMilliseconds,
        actualMilliseconds: record.actualMilliseconds,
        overtimeMilliseconds: record.overtimeMilliseconds,
        leaveMilliseconds: record.leaveMilliseconds,
        remark: record.remark,
      })),
      dateKeys,
      calendarDays,
    });
    await logOp({
      userId: actor.id,
      action: 'export_attendance_workbook',
      targetType: 'attendance_record',
      detail: {
        period: range.period,
        startDate: rangeStartKey,
        endDate: rangeEndKey,
        scope,
        employeeCount: workbook.employeeCount,
        confirmedRecordCount: workbook.confirmedRecordCount,
        draftRecordCount: workbook.draftRecordCount,
        missingRecordCount: workbook.missingRecordCount,
        sheetCount: 1,
      },
    });
    const fileName = `员工出勤记录表_${rangeStartKey}_${rangeEndKey}.xlsx`;
    const responseBody = workbook.buffer.buffer.slice(
      workbook.buffer.byteOffset,
      workbook.buffer.byteOffset + workbook.buffer.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '考勤导出失败';
    console.error('attendance workbook export failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
