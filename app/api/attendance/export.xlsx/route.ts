import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  effectiveAttendanceWorkforceScope,
  resolveAttendanceAccessBoundary,
} from '@/lib/attendance-access';
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

function hours(milliseconds: number): number {
  return Number((Math.max(0, milliseconds) / 3_600_000).toFixed(2));
}

function statusLabel(status: string): string {
  return status === 'confirmed' ? '已确认' : '草稿';
}

function attendanceTypeLabel(type: string): string {
  return type === 'leave' ? '请假' : type === 'absent' ? '缺勤' : type === 'rest' ? '休息日' : '正常出勤';
}

function addSheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[]): void {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

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
    const [records, abnormalEvents] = await Promise.all([
      employeeIds.length ? prisma.attendanceRecord.findMany({
        where: {
          employeeId: { in: employeeIds },
          workDate: { gte: startDate, lt: endDate },
          ...attendanceRecordScopeWhere(scope),
        },
        include: {
          employee: true,
          confirmedBy: { select: { displayName: true, username: true } },
        },
        orderBy: [{ workDate: 'asc' }, { employee: { employeeNo: 'asc' } }],
      }) : Promise.resolve([]),
      employeeIds.length ? prisma.abnormalTimeEvent.findMany({
        where: {
          deletedAt: null,
          workDate: { gte: startDate, lt: endDate },
          allocations: { some: { employeeId: { in: employeeIds } } },
        },
        include: {
          allocations: {
            where: { employeeId: { in: employeeIds } },
            include: { employee: true },
          },
        },
        orderBy: [{ workDate: 'asc' }, { sequence: 'asc' }],
      }) : Promise.resolve([]),
    ]);
    const workbook = XLSX.utils.book_new();
    const endInclusive = new Date(range.end.getTime() - 1);
    const rangeEndKey = endInclusive.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const rangeStartKey = range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    addSheet(workbook, '导出说明', [
      ['项目', '内容'],
      ['统计周期', range.period],
      ['日期范围', `${rangeStartKey} 至 ${rangeEndKey}（含首尾日期，Asia/Shanghai）`],
      ['人员范围', scope],
      ['员工数量', employees.length],
      ['正式口径', '只有“已确认”考勤进入正式出勤统计；草稿和缺失记录单独列出，不进入达成率。'],
      ['达成率资格', '主管/组长等不计达成率的员工仍保留在人事考勤导出中。'],
      ['导出时间', new Date().toISOString()],
    ], [18, 76]);

    const byEmployee = new Map(employees.map(employee => [employee.id, {
      employee,
      confirmed: 0,
      draft: 0,
      actual: 0,
      overtime: 0,
      leave: 0,
    }]));
    for (const record of records) {
      const row = byEmployee.get(record.employeeId);
      if (!row) continue;
      if (record.status === 'confirmed') {
        row.confirmed += 1;
        row.actual += record.actualMilliseconds;
        row.overtime += record.overtimeMilliseconds;
        row.leave += record.leaveMilliseconds;
      } else row.draft += 1;
    }
    addSheet(workbook, '员工汇总', [
      ['工号', '姓名', '部门', '班组', '岗位', '达成率资格', '确认天数', '草稿天数', '有效出勤(h)', '加班(h)', '请假(h)'],
      ...[...byEmployee.values()].map(row => [
        row.employee.employeeNo, row.employee.name, row.employee.department || '', row.employee.team || '', row.employee.position || '',
        row.employee.attainmentEligible ? '计入生产达成率' : '仅考勤，不计生产达成率', row.confirmed, row.draft,
        hours(row.actual), hours(row.overtime), hours(row.leave),
      ]),
    ], [12, 12, 14, 14, 16, 24, 11, 11, 14, 12, 12]);

    const recordMap = new Map(records.map(record => [`${record.employeeId}:${dateKeyFromDatabase(record.workDate)}`, record]));
    const dateKeys = reportRangeDateKeys(range.start, range.end);
    addSheet(workbook, '每日明细', [
      ['日期', '工号', '姓名', '部门', '班组', '岗位', '记录状态', '出勤类型', '有效出勤(h)', '加班(h)', '请假(h)', '确认人', '确认时间', '备注'],
      ...employees.flatMap(employee => dateKeys.map(dateKey => {
        const record = recordMap.get(`${employee.id}:${dateKey}`);
        return record ? [
          dateKey, employee.employeeNo, employee.name, record.departmentSnapshot || employee.department || '',
          record.teamSnapshot || employee.team || '', record.positionSnapshot || employee.position || '', statusLabel(record.status),
          attendanceTypeLabel(record.attendanceType), hours(record.actualMilliseconds), hours(record.overtimeMilliseconds),
          hours(record.leaveMilliseconds), record.confirmedBy?.displayName || record.confirmedBy?.username || '',
          record.confirmedAt?.toISOString() || '', record.remark || '',
        ] : [dateKey, employee.employeeNo, employee.name, employee.department || '', employee.team || '', employee.position || '', '缺失', '', '', '', '', '', '', ''];
      })),
    ], [12, 12, 12, 14, 14, 16, 12, 12, 14, 12, 12, 14, 22, 30]);

    const teamMap = new Map<string, { employees: Set<string>; confirmed: number; draft: number; actual: number; planned: number }>();
    for (const record of records) {
      const team = record.teamSnapshot || record.employee.team || record.positionSnapshot || '未分组';
      const row = teamMap.get(team) || { employees: new Set<string>(), confirmed: 0, draft: 0, actual: 0, planned: 0 };
      row.employees.add(record.employeeId);
      if (record.status === 'confirmed') {
        row.confirmed += 1;
        row.actual += record.actualMilliseconds;
        row.planned += record.attendanceType === 'rest' ? 0 : record.plannedMilliseconds;
      } else row.draft += 1;
      teamMap.set(team, row);
    }
    addSheet(workbook, '班组汇总', [
      ['班组', '涉及员工', '确认记录', '草稿记录', '应出勤(h)', '有效出勤(h)', '工时出勤率'],
      ...[...teamMap.entries()].map(([team, row]) => [team, row.employees.size, row.confirmed, row.draft, hours(row.planned), hours(row.actual), row.planned > 0 ? `${((row.actual / row.planned) * 100).toFixed(1)}%` : '—']),
    ], [16, 12, 12, 12, 14, 14, 14]);

    addSheet(workbook, '异常与草稿', [
      ['类型', '日期', '员工', '内容', '状态', '时长(h)', '备注'],
      ...records.filter(record => record.status !== 'confirmed').map(record => ['考勤草稿', dateKeyFromDatabase(record.workDate), record.employee.name, attendanceTypeLabel(record.attendanceType), '草稿', hours(record.actualMilliseconds), record.remark || '']),
      ...abnormalEvents.flatMap(event => event.allocations.map(allocation => ['异常工时', dateKeyFromDatabase(event.workDate), allocation.employee.name, `${event.title}${event.reason ? `：${event.reason}` : ''}`, `${event.qualityStatus}/${event.resolutionStatus}`, hours(allocation.durationMilliseconds), event.employeeExempt ? '申请免责' : '不免责'])),
    ], [14, 12, 14, 46, 18, 12, 22]);

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
    await logOp({
      userId: actor.id,
      action: 'export_attendance_workbook',
      targetType: 'attendance_record',
      detail: { period: range.period, startDate: rangeStartKey, endDate: rangeEndKey, scope, employeeCount: employees.length, recordCount: records.length },
    });
    const fileName = `考勤-${rangeStartKey}_${rangeEndKey}.xlsx`;
    return new NextResponse(buffer, {
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
