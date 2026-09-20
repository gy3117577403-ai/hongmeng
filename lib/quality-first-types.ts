import type { QualityOrder, QualityRecord } from './quality-data';

export type FirstActivity = { firstUploadedAt: string | null; lastUploadedAt: string | null; uploadedBy: string; changedAt: string };
export type FirstRecord = QualityRecord & { activity: FirstActivity };
export type FirstOrder = QualityOrder & { submittedCount: number; draftCount: number; completedSteps: number; lastUploadedAt: string | null };
export type FirstOrders = { items: FirstOrder[]; total: number; page: number; counts: { all: number; done: number; todo: number } };
export type FirstRecords = { items: FirstRecord[]; total: number; page: number };

export function firstTime(value?: string | null) {
  if (!value) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
