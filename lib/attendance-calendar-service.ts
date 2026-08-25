import { parseWorkDate } from '@/lib/attendance';
import {
  attendanceCalendarDayLabel,
  resolveAttendanceCalendarDay,
  type ResolvedAttendanceCalendarDay,
} from '@/lib/attendance-calendar';
import { prisma } from '@/lib/prisma';

export async function readAttendanceCalendarDay(dateKey: string): Promise<ResolvedAttendanceCalendarDay> {
  const workDate = parseWorkDate(dateKey);
  const override = await prisma.attendanceCalendarDay.findUnique({
    where: { workDate: workDate.value },
    select: { dayType: true, label: true, remark: true },
  });
  return resolveAttendanceCalendarDay(dateKey, override ? {
    dayType: override.dayType as 'default' | 'holiday' | 'temporary_workday',
    label: override.label,
    remark: override.remark,
  } : null);
}

export async function requireAttendanceWorkday(dateKey: string): Promise<ResolvedAttendanceCalendarDay> {
  const day = await readAttendanceCalendarDay(dateKey);
  if (!day.isWorkday) {
    const label = attendanceCalendarDayLabel(day);
    throw new Error(`${dateKey} 为${label}，不能生成、修改或确认出勤；如为临时加班，请先在出勤日历标记为临时工作日`);
  }
  return day;
}
