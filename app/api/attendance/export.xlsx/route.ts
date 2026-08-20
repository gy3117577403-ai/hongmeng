import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
import { createAttendanceWorkbook } from '@/lib/attendance-workbook';
import { dateKeyFromDatabase, parseAttendanceEmployeeIds, parseWorkDate } from '@/lib/attendance';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
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
    const records = employeeIds.length ? await prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: startDate, lt: endDate },
        ...attendanceRecordScopeWhere(scope),
      },
      orderBy: [{ workDate: 'asc' }, { employee: { employeeNo: 'asc' } }],
    }) : [];
    const endInclusive = new Date(range.end.getTime() - 1);
    const rangeEndKey = endInclusive.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const rangeStartKey = range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const dateKeys = reportRangeDateKeys(range.start, range.end);
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
      })),
      records: records.map(record => ({
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
