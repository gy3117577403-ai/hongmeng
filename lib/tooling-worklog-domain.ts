export const TOOLING_POSITIONS = ['UPPER_OUTER', 'UPPER_INNER', 'LOWER_OUTER', 'LOWER_INNER'] as const;
export type ToolingPosition = typeof TOOLING_POSITIONS[number];
export const TOOLING_POSITION_NAMES: Record<ToolingPosition, string> = {
  UPPER_OUTER: '上外刀', UPPER_INNER: '上内刀', LOWER_OUTER: '下外刀', LOWER_INNER: '下内刀',
};
export const TOOLING_STATES: Record<string, string> = {
  RUNNING: '调模中', PAUSED: '已暂停', COMPLETED: '已完成', INCOMPLETE: '需继续',
  AVAILABLE: '在库', IN_USE: '使用中', MAINTENANCE: '待处理', RETIRED: '已停用',
};
export const ASSIST_CATEGORIES = ['生产协助', '设备维护', '刀片整理', '异常处理', '其他协助'];
export const boxName = (box: number | null | undefined) => box == null ? '不在盒内' : String(box).padStart(3, '0') + ' 号盒';
export function durationText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function shanghaiDay(date: Date | string | number) {
  return new Date(new Date(date).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
export function worklogRange(period: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期');
  const base = new Date(date + 'T00:00:00+08:00');
  if (!Number.isFinite(base.getTime()) || shanghaiDay(base) !== date) throw new Error('请选择有效日期');
  let start = base.getTime(), end = start + 86400_000;
  if (period === 'week') {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    start -= ((weekday + 6) % 7) * 86400_000; end = start + 7 * 86400_000;
  } else if (period === 'month') {
    const [year, month] = date.split('-').map(Number);
    start = Date.UTC(year, month - 1, 1) - 8 * 3600_000;
    end = Date.UTC(year, month, 1) - 8 * 3600_000;
  }
  return { start: new Date(start), end: new Date(end) };
}
export type WorkSegment = { kind: string; startedAt: Date | string; endedAt: Date | string | null };
/** Split elapsed facts at Shanghai midnight. Pause segments never contribute to work time. */
export function segmentDays(segments: WorkSegment[], now = new Date(), range?: { start: Date; end: Date }) {
  const days: Record<string, { workMs: number; waitMs: number }> = {};
  for (const segment of segments) {
    let cursor = Math.max(new Date(segment.startedAt).getTime(), range?.start.getTime() ?? 0);
    const end = Math.min(new Date(segment.endedAt || now).getTime(), range?.end.getTime() ?? Infinity, now.getTime());
    while (cursor < end) {
      const day = shanghaiDay(cursor);
      const boundary = new Date(day + 'T00:00:00+08:00').getTime() + 86400_000;
      const until = Math.min(end, boundary);
      const value = days[day] ||= { workMs: 0, waitMs: 0 };
      value[segment.kind === 'WORK' ? 'workMs' : 'waitMs'] += until - cursor;
      cursor = until;
    }
  }
  return days;
}
export function segmentTotals(segments: WorkSegment[], now = new Date()) {
  return Object.values(segmentDays(segments, now)).reduce((sum, day) => ({ workMs: sum.workMs + day.workMs, waitMs: sum.waitMs + day.waitMs }), { workMs: 0, waitMs: 0 });
}
export type StockUnit = {
  id: string; bladeId: string; position: ToolingPosition; kitId: string | null; homeBox: number;
  currentBox: number | null; state: string; version: number;
  kit?: { code: string } | null; inUseJobId?: string | null;
  inUseJob?: { actorName: string; equipment?: string; status: string } | null;
};
/** A kit is a physical grouping, never an extra quantity on top of its components. */
export function stockSummary(units: StockUnit[]) {
  const live = units.filter(u => u.state !== 'RETIRED');
  const kits = new Map<string, StockUnit[]>();
  for (const u of live) if (u.kitId) kits.set(u.kitId, [...(kits.get(u.kitId) || []), u]);
  const completeKits = [...kits.values()].filter(group => TOOLING_POSITIONS.every(p => group.some(u => u.position === p && u.state === 'AVAILABLE'))
    && new Set(group.map(u => u.currentBox)).size === 1).length;
  const incompleteKits = [...kits.values()].filter(group => !TOOLING_POSITIONS.every(p => group.some(u => u.position === p))).length;
  return { registered: units.length > 0, total: live.length, available: live.filter(u => u.state === 'AVAILABLE').length,
    inUse: live.filter(u => u.state === 'IN_USE').length, maintenance: live.filter(u => u.state === 'MAINTENANCE').length,
    completeKits, incompleteKits, loose: live.filter(u => !u.kitId).length,
    boxes: [...new Set(live.filter(u => u.currentBox != null).map(u => u.currentBox!))].sort((a, b) => a - b) };
}
export type ToolingUsageDTO = {
  id: string; position: ToolingPosition; bladeId: string; stockId: string | null; isCurrent: boolean;
  snapshot: { model: string; specification: string | null; homeBox: number | null; kitCode: string | null };
  disposition: string | null; startedAt: string; endedAt: string | null;
};
export type ToolingJobDTO = {
  id: string; actorId: string; employeeId: string; actorName: string; employeeNo: string; kind: string; status: string;
  terminalId: string | null; setupId: string | null; terminalSnapshot: { specification?: string; manufacturer?: string | null };
  contextSnapshot: { wireRange?: string; equipment?: string; mold?: string };
  description: string; category: string; resultNote: string; backfillReason: string | null;
  startedAt: string; endedAt: string | null; version: number; workMs: number; waitMs: number;
  segments: Array<{ id: string; kind: string; reason: string; startedAt: string; endedAt: string | null }>;
  usages: ToolingUsageDTO[];
  events: Array<{ id: string; actorName: string; action: string; detail: Record<string, unknown>; createdAt: string }>;
  ledger: Array<{ id: string; workDate: string; requestedMinutes: number; reportedMilliseconds: number | null; status: string }>;
};
