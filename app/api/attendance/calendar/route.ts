import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import {
  attendanceCalendarDayLabel,
  attendanceMonthKey,
  parseAttendanceCalendarDayType,
  resolveAttendanceCalendarDay,
} from '@/lib/attendance-calendar';
import { logOp } from '@/lib/logs';
import { cleanProcessText } from '@/lib/process-time';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentShanghaiMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).format(new Date());
}

function monthDateKeys(month: string): string[] {
  const cursor = new Date(`${month}-01T12:00:00Z`);
  const keys: string[] = [];
  while (cursor.toISOString().slice(0, 7) === month) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const month = attendanceMonthKey(req.nextUrl.searchParams.get('month') || currentShanghaiMonth());
    const dateKeys = monthDateKeys(month);
    const start = parseWorkDate(dateKeys[0]).value;
    const endCursor = new Date(`${dateKeys[dateKeys.length - 1]}T12:00:00Z`);
    endCursor.setUTCDate(endCursor.getUTCDate() + 1);
    const end = parseWorkDate(endCursor.toISOString().slice(0, 10)).value;
    const [overrides, records] = await Promise.all([
      prisma.attendanceCalendarDay.findMany({
        where: { workDate: { gte: start, lt: end } },
        orderBy: { workDate: 'asc' },
      }),
      prisma.attendanceRecord.findMany({
        where: { workDate: { gte: start, lt: end } },
        select: { workDate: true, status: true },
      }),
    ]);
    const overrideByDate = new Map(overrides.map(item => [dateKeyFromDatabase(item.workDate), item]));
    const recordCounts = new Map<string, { confirmed: number; draft: number }>();
    for (const record of records) {
      const key = dateKeyFromDatabase(record.workDate);
      const current = recordCounts.get(key) || { confirmed: 0, draft: 0 };
      if (record.status === 'confirmed') current.confirmed += 1;
      else current.draft += 1;
      recordCounts.set(key, current);
    }
    const days = dateKeys.map(date => {
      const override = overrideByDate.get(date);
      const resolved = resolveAttendanceCalendarDay(date, override ? {
        dayType: override.dayType as 'default' | 'holiday' | 'temporary_workday',
        label: override.label,
        remark: override.remark,
      } : null);
      const counts = recordCounts.get(date) || { confirmed: 0, draft: 0 };
      return {
        ...resolved,
        displayLabel: attendanceCalendarDayLabel(resolved),
        confirmedRecords: counts.confirmed,
        draftRecords: counts.draft,
      };
    });
    return NextResponse.json({ ok: true, month, days });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '出勤日历加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workDate = parseWorkDate(body.workDate);
    const dayType = parseAttendanceCalendarDayType(body.dayType);
    const label = dayType === 'default' ? null : cleanProcessText(body.label, 80) || null;
    const remark = dayType === 'default' ? null : cleanProcessText(body.remark, 300) || null;
    const before = await prisma.attendanceCalendarDay.findUnique({ where: { workDate: workDate.value } });
    const [saved, confirmedRecords, draftRecords] = await prisma.$transaction([
      prisma.attendanceCalendarDay.upsert({
        where: { workDate: workDate.value },
        create: {
          workDate: workDate.value,
          dayType,
          label,
          remark,
          updatedById: user.id,
        },
        update: {
          dayType,
          label,
          remark,
          updatedById: user.id,
        },
      }),
      prisma.attendanceRecord.count({ where: { workDate: workDate.value, status: 'confirmed' } }),
      prisma.attendanceRecord.count({ where: { workDate: workDate.value, status: 'draft' } }),
    ]);
    const resolved = resolveAttendanceCalendarDay(workDate.key, {
      dayType: saved.dayType as 'default' | 'holiday' | 'temporary_workday',
      label: saved.label,
      remark: saved.remark,
    });
    await logOp({
      userId: user.id,
      action: 'update_attendance_calendar_day',
      targetType: 'attendance_calendar_day',
      targetId: saved.id,
      detail: {
        workDate: workDate.key,
        beforeDayType: before?.dayType || null,
        dayType,
        effectiveDayType: resolved.effectiveDayType,
        label,
        remark,
        retainedConfirmedRecords: confirmedRecords,
        retainedDraftRecords: draftRecords,
      },
    });
    return NextResponse.json({
      ok: true,
      day: {
        ...resolved,
        displayLabel: attendanceCalendarDayLabel(resolved),
        confirmedRecords,
        draftRecords,
      },
      message: resolved.isWorkday
        ? `${workDate.key} 已设为${attendanceCalendarDayLabel(resolved)}，可进入考勤流程`
        : `${workDate.key} 已设为${attendanceCalendarDayLabel(resolved)}，历史记录保留但不进入有效统计`,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '出勤日历保存失败';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
