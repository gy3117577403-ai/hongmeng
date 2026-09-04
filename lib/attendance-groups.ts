import type { Prisma } from '@prisma/client';

export const ATTENDANCE_GROUPS = [
  'PRODUCTION_FRONT',
  'PRODUCTION_BACK',
  'SAMPLE',
  'OTHER',
  'UNASSIGNED',
] as const;

export type AttendanceGroup = (typeof ATTENDANCE_GROUPS)[number];

export class AttendanceGroupInputError extends Error {}

export const ATTENDANCE_GROUP_OPTIONS: ReadonlyArray<{
  value: AttendanceGroup;
  label: string;
  shortLabel: string;
}> = [
  { value: 'PRODUCTION_FRONT', label: '前端生产', shortLabel: '前端' },
  { value: 'PRODUCTION_BACK', label: '后端装配', shortLabel: '后端' },
  { value: 'SAMPLE', label: '样品组', shortLabel: '样品' },
  { value: 'OTHER', label: '其他人员', shortLabel: '其他' },
  { value: 'UNASSIGNED', label: '未分组', shortLabel: '未分组' },
];

const GROUP_SET = new Set<string>(ATTENDANCE_GROUPS);

export function parseAttendanceGroup(value: unknown, fallback: AttendanceGroup = 'UNASSIGNED'): AttendanceGroup {
  const normalized = String(value ?? '').trim().toUpperCase();
  return GROUP_SET.has(normalized) ? normalized as AttendanceGroup : fallback;
}

export function parseOptionalAttendanceGroup(value: unknown): AttendanceGroup | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!GROUP_SET.has(normalized)) throw new AttendanceGroupInputError('请选择有效的考勤分组');
  return normalized as AttendanceGroup;
}

/**
 * One-time/default suggestion for legacy personnel only. The explicit field is
 * authoritative after HR saves it; unknown people deliberately remain visible
 * in “未分组” instead of being silently hidden or guessed.
 */
export function inferAttendanceGroup(input: {
  department?: unknown;
  position?: unknown;
  team?: unknown;
}): AttendanceGroup {
  const text = `${input.department ?? ''} ${input.position ?? ''} ${input.team ?? ''}`
    .normalize('NFKC')
    .replace(/\s+/g, '');
  if (/样品|样配/.test(text)) return 'SAMPLE';
  if (/后端|装配|插入|总装/.test(text)) return 'PRODUCTION_BACK';
  if (/前端|裁线|剥皮|压接|压裁/.test(text)) return 'PRODUCTION_FRONT';
  if (/生产|车间|制造/.test(text)) return 'UNASSIGNED';
  if (text) return 'OTHER';
  return 'UNASSIGNED';
}

export function attendanceGroupEmployeeWhere(group: AttendanceGroup | null): Prisma.EmployeeWhereInput {
  return group ? { attendanceGroup: group } : {};
}
