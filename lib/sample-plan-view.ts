import { chinaDateKey } from './china-date';

export const SAMPLE_VIEWS = ['UNFINISHED', 'TODAY', 'SOON', 'OVERDUE', 'PLANNED', 'IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'CANCELLED', 'ALL', 'DOCUMENT_PENDING', 'DRAWING_MISSING', 'DRAWING_DRAFT', 'DRAWING_REVIEW', 'DRAWING_RETURNED', 'DRAWING_APPROVED', 'SHORTAGE'] as const;
export type SamplePlanView = typeof SAMPLE_VIEWS[number];
export type SampleWarning = 'NONE' | 'MISSING' | 'NORMAL' | 'SOON' | 'TODAY' | 'OVERDUE';
export function sampleWarning(task: { status: string; dueDate: string | null; warningDays?: number }, today = chinaDateKey(new Date())): { kind: SampleWarning; label: string } {
  if (task.status === 'COMPLETED') return { kind: 'NONE', label: '已完成' };
  if (task.status === 'CANCELLED') return { kind: 'NONE', label: '已取消' };
  if (!task.dueDate) return { kind: 'MISSING', label: '出货日期未设置' };
  const days = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / 86400000);
  if (days < 0) return { kind: 'OVERDUE', label: `逾期 ${-days} 天` };
  if (!days) return { kind: 'TODAY', label: '今日到期' };
  return { kind: days <= (task.warningDays ?? 2) ? 'SOON' : 'NORMAL', label: `距交期 ${days} 天` };
}

export function sampleDateRange(period: string, today = chinaDateKey(new Date())) {
  const date = new Date(`${today}T00:00:00Z`);
  const key = (value: Date) => value.toISOString().slice(0, 10);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const from = key(date); date.setUTCDate(date.getUTCDate() + 6);
    return { from, to: key(date) };
  }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: key(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))) };
  return { from: '', to: '' };
}

export const SAMPLE_HOME_STATE_KEY = 'hongmeng-sample-home-view-v1';
export type SampleHomeState = { active: boolean; view: 'UNFINISHED' | 'COMPLETED'; keyword: string; page: number; scrollTop: number };
