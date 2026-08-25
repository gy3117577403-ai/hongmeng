export const ATTENDANCE_CALENDAR_DAY_TYPES = ['default', 'holiday', 'temporary_workday'] as const;

export type AttendanceCalendarDayType = typeof ATTENDANCE_CALENDAR_DAY_TYPES[number];
export type EffectiveAttendanceCalendarDayType = 'workday' | 'weekly_rest' | 'holiday' | 'temporary_workday';

export type AttendanceCalendarOverride = {
  dayType: AttendanceCalendarDayType;
  label?: string | null;
  remark?: string | null;
} | null | undefined;

export type ResolvedAttendanceCalendarDay = {
  date: string;
  weekday: string;
  weekdayIndex: number;
  isWeekend: boolean;
  defaultDayType: 'workday' | 'weekly_rest';
  overrideDayType: AttendanceCalendarDayType | null;
  effectiveDayType: EffectiveAttendanceCalendarDayType;
  isWorkday: boolean;
  label: string | null;
  remark: string | null;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(dateKey: string): void {
  if (!DATE_KEY_PATTERN.test(dateKey)) throw new Error('日期格式必须为 YYYY-MM-DD');
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new Error('日期不是有效日历日期');
  }
}

export function attendanceWeekdayIndex(dateKey: string): number {
  assertDateKey(dateKey);
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export function parseAttendanceCalendarDayType(value: unknown): AttendanceCalendarDayType {
  if (typeof value === 'string' && ATTENDANCE_CALENDAR_DAY_TYPES.includes(value as AttendanceCalendarDayType)) {
    return value as AttendanceCalendarDayType;
  }
  throw new Error('日历类型只支持默认规则、节假日或临时工作日');
}

export function resolveAttendanceCalendarDay(
  dateKey: string,
  override?: AttendanceCalendarOverride,
): ResolvedAttendanceCalendarDay {
  const weekdayIndex = attendanceWeekdayIndex(dateKey);
  const defaultDayType = weekdayIndex === 0 ? 'weekly_rest' : 'workday';
  const overrideDayType = override?.dayType || null;
  const effectiveDayType: EffectiveAttendanceCalendarDayType = overrideDayType === 'holiday'
    ? 'holiday'
    : overrideDayType === 'temporary_workday'
      ? 'temporary_workday'
      : defaultDayType;
  return {
    date: dateKey,
    weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekdayIndex],
    weekdayIndex,
    isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
    defaultDayType,
    overrideDayType,
    effectiveDayType,
    isWorkday: effectiveDayType === 'workday' || effectiveDayType === 'temporary_workday',
    label: override?.label?.trim() || null,
    remark: override?.remark?.trim() || null,
  };
}

export function attendanceCalendarDayLabel(day: ResolvedAttendanceCalendarDay): string {
  if (day.effectiveDayType === 'weekly_rest') return '周休';
  if (day.effectiveDayType === 'holiday') return day.label || '节假日';
  if (day.effectiveDayType === 'temporary_workday') return day.label || '临时工作日';
  return '正常工作日';
}

export function attendanceMonthKey(value: string): string {
  const raw = value.trim();
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.slice(0, 7) : '';
  if (!month) throw new Error('月份格式必须为 YYYY-MM');
  const monthDate = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(monthDate.getTime()) || monthDate.toISOString().slice(0, 7) !== month) {
    throw new Error('月份不是有效日历月份');
  }
  return month;
}
