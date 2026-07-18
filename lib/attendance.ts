import type { Prisma } from '@prisma/client';
import { chinaDateKey } from '@/lib/china-date';
import { cleanProcessText, employeeReportRange, serializeEmployee } from '@/lib/process-time';
import type {
  AbnormalTimeCategory,
  AbnormalTimeEventDTO,
  AttendanceRecordDTO,
  AttendanceSegmentDTO,
  AttendanceSegmentType,
  AttendanceType,
} from '@/types';

export const STANDARD_DAY_MILLISECONDS = 8 * 60 * 60 * 1000;
export const MINUTE_MILLISECONDS = 60 * 1000;
export const ATTAINMENT_CAPACITY_FACTOR = 0.95;

export const ABNORMAL_TIME_CATEGORIES: Array<{ value: AbnormalTimeCategory; label: string }> = [
  { value: 'equipment', label: '设备异常' },
  { value: 'material_shortage', label: '缺料' },
  { value: 'wrong_material', label: '错料' },
  { value: 'waiting_drawing', label: '等待图纸' },
  { value: 'waiting_technical', label: '等待技术确认' },
  { value: 'process_change', label: '工艺变更' },
  { value: 'incoming_quality', label: '来料质量' },
  { value: 'tooling', label: '工装夹具' },
  { value: 'planning_change', label: '计划变更' },
  { value: 'power_network_system', label: '电力 / 网络 / 系统' },
  { value: 'other', label: '其他' },
];

type AttendanceWithRelations = Prisma.AttendanceRecordGetPayload<{
  include: {
    employee: true;
    confirmedBy: { select: { id: true; username: true; displayName: true } };
  };
}>;

type AbnormalEventWithRelations = Prisma.AbnormalTimeEventGetPayload<{
  include: {
    allocations: { include: { employee: true } };
    qualityConfirmedBy: { select: { id: true; username: true; displayName: true } };
    resolvedBy: { select: { id: true; username: true; displayName: true } };
    workOrder: {
      select: {
        id: true;
        code: true;
        customerName: true;
        specification: true;
        productName: true;
      };
    };
    processStep: { select: { id: true; processCode: true; processName: true } };
  };
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseWorkDate(value: unknown): { key: string; value: Date } {
  const key = cleanProcessText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('请选择有效日期');
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) throw new Error('请选择有效日期');
  return { key, value: date };
}

export function dateKeyFromDatabase(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseAttendanceType(value: unknown): AttendanceType {
  if (value === 'leave' || value === 'absent' || value === 'rest') return value;
  return 'normal';
}

export function parseAbnormalCategory(value: unknown): AbnormalTimeCategory {
  const candidate = cleanProcessText(value, 40) as AbnormalTimeCategory;
  return ABNORMAL_TIME_CATEGORIES.some(item => item.value === candidate) ? candidate : 'other';
}

export function abnormalCategoryLabel(category: string): string {
  return ABNORMAL_TIME_CATEGORIES.find(item => item.value === category)?.label || '其他';
}

function parseDateTime(value: unknown, workDate: string, label: string): Date {
  const raw = cleanProcessText(value, 80);
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) throw new Error(`${label}无效`);
  if (chinaDateKey(date) !== workDate) throw new Error(`${label}必须在 ${workDate} 当天，系统暂不支持跨天班次`);
  return date;
}

export function defaultAttendanceSegments(workDate: string): AttendanceSegmentDTO[] {
  return [
    createSegment('regular', `${workDate}T08:00:00+08:00`, `${workDate}T12:00:00+08:00`),
    createSegment('regular', `${workDate}T13:00:00+08:00`, `${workDate}T17:00:00+08:00`),
  ];
}

function createSegment(type: AttendanceSegmentType, startedAt: string, endedAt: string): AttendanceSegmentDTO {
  const durationMilliseconds = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return {
    type,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMilliseconds,
  };
}

export function parseAttendanceSegments(value: unknown, workDate: string): AttendanceSegmentDTO[] {
  if (!Array.isArray(value)) throw new Error('出勤时段格式不正确');
  const segments = value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`第 ${index + 1} 个出勤时段格式不正确`);
    const type: AttendanceSegmentType = raw.type === 'overtime' ? 'overtime' : 'regular';
    const startedAt = parseDateTime(raw.startedAt, workDate, `第 ${index + 1} 个时段开始时间`);
    const endedAt = parseDateTime(raw.endedAt, workDate, `第 ${index + 1} 个时段结束时间`);
    if (endedAt <= startedAt) throw new Error(`第 ${index + 1} 个时段结束时间必须晚于开始时间`);
    return {
      type,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMilliseconds: endedAt.getTime() - startedAt.getTime(),
    };
  }).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  for (let index = 1; index < segments.length; index += 1) {
    if (new Date(segments[index].startedAt) < new Date(segments[index - 1].endedAt)) {
      throw new Error('出勤时段不能互相重叠');
    }
  }
  const total = segments.reduce((sum, item) => sum + item.durationMilliseconds, 0);
  if (total > 20 * 60 * 60 * 1000) throw new Error('单日出勤时长不能超过 20 小时');
  return segments;
}

export function attendanceTotals(input: {
  attendanceType: AttendanceType;
  segments: AttendanceSegmentDTO[];
  leaveMinutes: unknown;
}): { leaveMilliseconds: number; actualMilliseconds: number; overtimeMilliseconds: number } {
  const total = input.segments.reduce((sum, item) => sum + item.durationMilliseconds, 0);
  const overtimeMilliseconds = input.segments
    .filter(item => item.type === 'overtime')
    .reduce((sum, item) => sum + item.durationMilliseconds, 0);
  if (input.attendanceType === 'absent' || input.attendanceType === 'rest') {
    return { leaveMilliseconds: 0, actualMilliseconds: 0, overtimeMilliseconds: 0 };
  }
  if (input.attendanceType === 'leave') {
    return { leaveMilliseconds: STANDARD_DAY_MILLISECONDS, actualMilliseconds: 0, overtimeMilliseconds: 0 };
  }
  const leaveMinutes = Number(input.leaveMinutes ?? 0);
  if (!Number.isFinite(leaveMinutes) || leaveMinutes < 0) throw new Error('请假分钟数不能小于 0');
  const leaveMilliseconds = Math.round(leaveMinutes * MINUTE_MILLISECONDS);
  if (leaveMilliseconds > total) throw new Error('请假时长不能超过已登记出勤时段');
  return {
    leaveMilliseconds,
    actualMilliseconds: total - leaveMilliseconds,
    overtimeMilliseconds,
  };
}

export function parseEventDateTimes(input: {
  workDate: unknown;
  startedAt: unknown;
  endedAt: unknown;
}): { workDateKey: string; workDate: Date; startedAt: Date; endedAt: Date; durationMilliseconds: number } {
  const parsedDate = parseWorkDate(input.workDate);
  const startedAt = parseDateTime(input.startedAt, parsedDate.key, '异常开始时间');
  const endedAt = parseDateTime(input.endedAt, parsedDate.key, '异常结束时间');
  if (endedAt <= startedAt) throw new Error('异常结束时间必须晚于开始时间');
  const durationMilliseconds = endedAt.getTime() - startedAt.getTime();
  if (durationMilliseconds > 20 * 60 * 60 * 1000) throw new Error('单条异常时长不能超过 20 小时');
  return { workDateKey: parsedDate.key, workDate: parsedDate.value, startedAt, endedAt, durationMilliseconds };
}

export function parseEmployeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('请选择受影响员工');
  const ids = [...new Set(value.map(item => cleanProcessText(item, 80)).filter(Boolean))];
  if (!ids.length) throw new Error('至少选择一名受影响员工');
  if (ids.length > 100) throw new Error('单条异常最多关联 100 名员工');
  return ids;
}

export function segmentsFromJson(value: Prisma.JsonValue): AttendanceSegmentDTO[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    if (!isRecord(raw)) return [];
    const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : '';
    const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : '';
    const durationMilliseconds = Number(raw.durationMilliseconds || 0);
    if (!startedAt || !endedAt || !Number.isFinite(durationMilliseconds)) return [];
    return [{
      type: raw.type === 'overtime' ? 'overtime' as const : 'regular' as const,
      startedAt,
      endedAt,
      durationMilliseconds,
    }];
  });
}

export function serializeAttendanceRecord(record: AttendanceWithRelations): AttendanceRecordDTO {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employee: serializeEmployee(record.employee),
    workDate: dateKeyFromDatabase(record.workDate),
    status: record.status === 'confirmed' ? 'confirmed' : 'draft',
    attendanceType: parseAttendanceType(record.attendanceType),
    plannedMilliseconds: record.plannedMilliseconds,
    leaveMilliseconds: record.leaveMilliseconds,
    actualMilliseconds: record.actualMilliseconds,
    overtimeMilliseconds: record.overtimeMilliseconds,
    segments: segmentsFromJson(record.segments),
    source: record.source,
    remark: record.remark,
    confirmedBy: record.confirmedBy,
    confirmedAt: record.confirmedAt?.toISOString() || null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function serializeAbnormalTimeEvent(event: AbnormalEventWithRelations): AbnormalTimeEventDTO {
  const allocations = event.allocations.map(item => ({
    id: item.id,
    employeeId: item.employeeId,
    employee: serializeEmployee(item.employee),
    durationMilliseconds: item.durationMilliseconds,
  }));
  return {
    id: event.id,
    sequence: event.sequence,
    workDate: dateKeyFromDatabase(event.workDate),
    category: parseAbnormalCategory(event.category),
    categoryLabel: abnormalCategoryLabel(event.category),
    title: event.title,
    reason: event.reason,
    startedAt: event.startedAt.toISOString(),
    endedAt: event.endedAt.toISOString(),
    durationMilliseconds: event.durationMilliseconds,
    affectedPersonMilliseconds: allocations.reduce((sum, item) => sum + item.durationMilliseconds, 0),
    employeeExempt: event.employeeExempt,
    qualityStatus: event.qualityStatus === 'confirmed' ? 'confirmed' : event.qualityStatus === 'rejected' ? 'rejected' : 'pending',
    qualityNote: event.qualityNote,
    qualityConfirmedBy: event.qualityConfirmedBy,
    qualityConfirmedAt: event.qualityConfirmedAt?.toISOString() || null,
    resolutionStatus: event.resolutionStatus === 'resolved' ? 'resolved' : 'open',
    responsibilityDepartment: event.responsibilityDepartment,
    expectedResolvedAt: event.expectedResolvedAt?.toISOString() || null,
    resolutionNote: event.resolutionNote,
    resolvedBy: event.resolvedBy,
    resolvedAt: event.resolvedAt?.toISOString() || null,
    workOrder: event.workOrder,
    processStep: event.processStep,
    allocations,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export function attendanceRange(period: 'today' | 'week' | 'month', date?: string | null) {
  return employeeReportRange(period, date);
}

export function intervalOverlaps(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function basisPoints(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.round((numerator / denominator) * 10_000));
}

export function attainmentCapacityMilliseconds(effectiveAttendanceMilliseconds: number): number {
  return Math.max(0, Math.round(effectiveAttendanceMilliseconds * ATTAINMENT_CAPACITY_FACTOR));
}
