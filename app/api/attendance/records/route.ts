import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  attendanceRange,
  attendanceTotals,
  defaultAttendanceSegments,
  parseAttendanceSegments,
  parseAttendanceType,
  parseWorkDate,
  serializeAttendanceRecord,
  STANDARD_DAY_MILLISECONDS,
} from '@/lib/attendance';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  employee: true,
  confirmedBy: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.AttendanceRecordInclude;

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const period = req.nextUrl.searchParams.get('period') === 'month'
      ? 'month' as const
      : req.nextUrl.searchParams.get('period') === 'week'
        ? 'week' as const
        : 'today' as const;
    const range = attendanceRange(period, req.nextUrl.searchParams.get('date'));
    const start = parseWorkDate(range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const end = parseWorkDate(range.end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const employeeId = cleanProcessText(req.nextUrl.searchParams.get('employeeId'), 80);
    const [records, employees] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          workDate: { gte: start, lt: end },
          ...(employeeId ? { employeeId } : {}),
        },
        include,
        orderBy: [{ workDate: 'desc' }, { employee: { employeeNo: 'asc' } }],
      }),
      prisma.employee.findMany({
        where: {
          isActive: true,
          attendanceEnabled: true,
          ...(employeeId ? { id: employeeId } : {}),
        },
        orderBy: { employeeNo: 'asc' },
      }),
    ]);
    const confirmed = records.filter(item => item.status === 'confirmed');
    return NextResponse.json({
      ok: true,
      period,
      date: range.date,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      records: records.map(serializeAttendanceRecord),
      summary: {
        enabledEmployeeCount: employees.length,
        recordCount: records.length,
        confirmedCount: confirmed.length,
        draftCount: records.length - confirmed.length,
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
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return NextResponse.json({ ok: false, error: '员工档案不存在' }, { status: 404 });
    if (!employee.attendanceEnabled) return NextResponse.json({ ok: false, error: '该员工未启用考勤' }, { status: 400 });
    const workDate = parseWorkDate(body.workDate);
    const attendanceType = parseAttendanceType(body.attendanceType);
    const requestedSegments = body.segments === undefined
      ? attendanceType === 'normal' ? defaultAttendanceSegments(workDate.key) : []
      : parseAttendanceSegments(body.segments, workDate.key);
    if (attendanceType === 'normal' && !requestedSegments.length) {
      return NextResponse.json({ ok: false, error: '正常出勤至少需要一个有效时段' }, { status: 400 });
    }
    const totals = attendanceTotals({ attendanceType, segments: requestedSegments, leaveMinutes: body.leaveMinutes });
    const confirm = body.confirm === true;
    const now = new Date();
    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_workDate: { employeeId, workDate: workDate.value } },
      create: {
        employeeId,
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
    });
    await logOp({
      userId: user.id,
      action: confirm ? 'confirm_attendance_record' : 'save_attendance_record',
      targetType: 'attendance_record',
      targetId: record.id,
      detail: { employeeId, workDate: workDate.key, attendanceType },
    });
    return NextResponse.json({ ok: true, record: serializeAttendanceRecord(record) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '考勤记录保存失败';
    console.error('save attendance record failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
