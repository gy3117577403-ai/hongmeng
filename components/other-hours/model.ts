export type Category = { id: string; name: string; isActive: boolean; version: number };
export type Photo = { id: string; originalName: string; url: string };
export type Row = {
  id: string; employeeId: string; version: number; workDate: string;
  employeeNameSnapshot: string; employeeNoSnapshot: string; teamSnapshot: string | null;
  categoryId: string; categoryNameSnapshot: string; requestedMinutes: number;
  approvedMinutes: number | null; status: string; description: string;
  arranger: string | null; sampleReference: string | null; backfillReason: string | null;
  startedAt: string | null; endedAt: string | null; reviewedByName: string | null; reviewedAt: string | null;
  correctionRequestedAt: string | null; correctionReason: string | null; correctionOfId: string | null;
  attachments: Photo[];
  reviews: { id: string; action: string; reason: string | null; createdAt: string; actor: { displayName: string; username: string } }[];
  permissions: { edit: boolean; submit: boolean; withdraw: boolean; review: boolean; void: boolean; requestCorrection: boolean };
};
export type Data = {
  rows: Row[]; categories: Category[]; summary: { approvedMinutes: number; pending: number };
  statusCounts: Record<string, number>;
  byCategory: { categoryNameSnapshot: string; _sum: { approvedMinutes: number | null }; _count: number }[];
  pagination: { page: number; size: number; total: number };
  permissions: { manage: boolean; admin: boolean }; today: string;
  employees?: { id: string; name: string; employeeNo: string }[];
};
export type Context = {
  attendanceStatus: string; attendanceMilliseconds: number; confirmedLossMilliseconds: number; reviewerAvailable: boolean;
  completions: { id: string; workStartedAt: string; workEndedAt: string }[];
  other: { id: string; status: string; categoryNameSnapshot: string; requestedMinutes: number; approvedMinutes: number | null }[];
  executions: { startedAt: string; endedAt: string; actualLaborMilliseconds: number }[]; reviewHint: string;
};
export type Form = {
  workDate: string; categoryId: string; requestedMinutes: number; description: string;
  backfillReason: string; startedAt: string; endedAt: string; employeeId: string;
};
export type Filters = { scope: string; status: string; search: string; categoryId: string; from: string; to: string; corrections: boolean; employeeId: string };
export const states: Record<string, string> = { DRAFT: '草稿', PENDING: '待审批', APPROVED: '已通过', REJECTED: '已退回', WITHDRAWN: '已撤回', VOIDED: '已作废' };
export const actions: Record<string, string> = { CREATE: '保存草稿', EDIT: '修改草稿', SUBMIT: '提交审批', APPROVE: '审批通过', REJECT: '退回修改', WITHDRAW: '撤回申请', VOID: '作废记录', CORRECTION_REQUEST: '申请更正', UPLOAD_PHOTO: '上传照片', DELETE_PHOTO: '移除照片', POLICY_CHANGE: '调岗口径同步' };
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
export const hours = (minutes: number) => (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 小时';
export const duration = (minutes: number) => minutes === 0 ? '时长待填写' : minutes % 60 === 0 ? hours(minutes) : minutes < 60 ? minutes + ' 分钟' : Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟';
export const dateTime = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export const timeOf = (date: string | null) => date ? new Date(date).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 5) : '';
export const initialForm = (): Form => ({ workDate: today(), categoryId: '', requestedMinutes: 0, description: '', backfillReason: '', startedAt: '', endedAt: '', employeeId: '' });
export function monthRange(date: string) {
  const [year, month] = date.split('-').map(Number);
  return { from: date.slice(0, 7) + '-01', to: date.slice(0, 7) + '-' + new Date(Date.UTC(year, month, 0)).getUTCDate() };
}
export function toForm(row: Row): Form {
  return { workDate: row.workDate, categoryId: row.categoryId, requestedMinutes: row.requestedMinutes, description: row.description,
    backfillReason: row.backfillReason || '', startedAt: timeOf(row.startedAt), endedAt: timeOf(row.endedAt), employeeId: '' };
}
export function queryFor(filters: Filters, page: number) {
  const query = new URLSearchParams({ scope: filters.scope, status: filters.status, page: String(page) });
  for (const key of ['search', 'categoryId', 'from', 'to', 'employeeId'] as const) if (filters[key]) query.set(key, filters[key]);
  if (filters.corrections) query.set('corrections', '1');
  return query;
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(value.error || '操作失败，请重试');
  return value;
}
export async function compressPhoto(file: File) {
  if (file.size < 1500000 || !file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } finally { bitmap.close(); }
}
