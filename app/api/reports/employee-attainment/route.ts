import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { employeeAttainmentScope } from '@/lib/employee-attainment-access';
import { resolveAttendanceAccessBoundary } from '@/lib/attendance-access';
import { dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { ReportDateRangeError, reportRangeQuery } from '@/lib/report-date-range';
import { attendanceRecordScopeWhere, isEmployeeEmployedOnDate, isProductionWorkforceEmployee } from '@/lib/production-workforce';
import { loadEmployeeHoursReport } from '@/lib/employee-hours-report-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    const { period, date, start, end } = reportRangeQuery(req.nextUrl.searchParams);
    const requestedEmployeeId = String(req.nextUrl.searchParams.get('employeeId') || '').trim();
    const startDate = parseWorkDate(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const endDate = parseWorkDate(end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    let scopedEmployeeIds: string[] | null = null;
    const accessScope = employeeAttainmentScope(actor);
    if (accessScope === 'SELF') {
      const actorEmployee = actor.employee;
      if (!actorEmployee || !isProductionWorkforceEmployee(actorEmployee)) {
        return forbidden('账号未绑定生产部且已启用考勤的在职员工档案，无法查看生产达成率');
      }
      scopedEmployeeIds = [actorEmployee.id];
    } else if (accessScope === 'TEAM') {
      const attendanceBoundary = await resolveAttendanceAccessBoundary(actor);
      const historicalRecords = await prisma.attendanceRecord.findMany({
        where: {
          workDate: { gte: startDate, lt: endDate },
          AND: [
            attendanceRecordScopeWhere('PRODUCTION'),
            attendanceBoundary.historicalRecordWhere,
          ],
        },
        include: { employee: true },
      });
      scopedEmployeeIds = [...new Set([
        ...(attendanceBoundary.employeeIds || []),
        ...historicalRecords
          .filter(record => isEmployeeEmployedOnDate(record.employee, dateKeyFromDatabase(record.workDate)))
          .map(record => record.employeeId),
      ])];
    }
    if (
      requestedEmployeeId
      && scopedEmployeeIds
      && !scopedEmployeeIds.includes(requestedEmployeeId)
    ) {
      return forbidden('当前账号无权查看该员工的达成率');
    }
    const employeeIdConstraint = requestedEmployeeId
      || (scopedEmployeeIds ? { in: scopedEmployeeIds } : undefined);
    const { report } = await loadEmployeeHoursReport({ period, date, start, end, employeeIdConstraint });
    if (requestedEmployeeId && !report.rows.some(row => row.employee.id === requestedEmployeeId)) {
      return NextResponse.json({ ok: false, error: '该员工不在生产部考勤统计范围内' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, report: { ...report, accessScope } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('employee attainment report failed', error);
    return NextResponse.json({ ok: false, error: '员工达成率报表加载失败' }, { status: 500 });
  }
}
