/** Shared display contract: a source is one task/revision, never a blended product record. */
export type LibraryProduct = { id: string; specification: string; customerName: string; productName: string | null; photos: number; parameters: number; tasks: number; updatedAt: string; thumbnailId: string | null };
export type LibraryHistory = { key: string; taskId: string; code: string; revision: number | null; status: string; date: string; photos: number; parameters: number; cancelled: boolean; unitPlannedMilliseconds: number | null };
export type LibraryEntry = { id: string; kind: string; label: string | null; payload: Record<string, unknown>; status: string; conflict: boolean; date: string };
export type LibraryPhoto = { id: string; category: string; caption: string | null; name: string; date: string; status: string };
export type LibrarySource = { history: LibraryHistory; entries: LibraryEntry[]; photos: LibraryPhoto[]; comment: string | null };
export type LibraryDetail = { product: Pick<LibraryProduct, 'id' | 'specification' | 'customerName' | 'productName'>; histories: LibraryHistory[]; defaultKey: string | null };
export const photoLabels: Record<string, string> = { UNCLASSIFIED: '未分类', PROCESS_TIME: '工序工时', STRIPPING: '剥皮参数', MATERIAL: '物料', NOTICE: '注意事项', SEMI_FINISHED: '半成品', PROCESS: '过程照片', MEASUREMENT: '测量记录', FINISHED: '成品', DETAIL: '局部细节', EXCEPTION: '异常参考' };
export const kindLabels: Record<string, string> = { PROCESS_TIME: '工序与工时', STRIPPING: '连接器与剥皮', MATERIAL: '物料参数', NOTICE: '注意事项', CUSTOM: '其他记录' };
export const statusLabels: Record<string, string> = { CONFIRMED: '已审核', REVIEWED: '已审核', APPROVED: '已审核', PUBLISHED: '已发布', PENDING: '待审核', DRAFT: '未审核参考', REJECTED: '已退回', CHANGES_REQUESTED: '待修改', WITHDRAWN: '已撤回', VOIDED: '已作废', LEGACY: '历史未审核参考' };
export const acceptedStatuses = ['CONFIRMED', 'REVIEWED', 'APPROVED', 'PUBLISHED'];
export function historicalOnly(source: Pick<LibraryHistory, 'status' | 'cancelled'>) { return source.cancelled || ['REJECTED', 'CHANGES_REQUESTED', 'WITHDRAWN', 'VOIDED'].includes(source.status); }
export function preferredHistory(histories: LibraryHistory[]): string | null {
  const candidates = histories.filter(row => !historicalOnly(row) && row.photos + row.parameters > 0);
  candidates.sort((a, b) => Number(acceptedStatuses.includes(b.status)) - Number(acceptedStatuses.includes(a.status)) || b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return candidates[0]?.key || null;
}
export function normalizedSampleSearch(value: string) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-‐‑–—_]+/g, ''); }
export function sampleSearchTokens(value: string) { return value.normalize('NFKC').trim().split(/\s+/).map(normalizedSampleSearch).filter(Boolean).slice(0, 8); }
export function safeLibraryReturn(value: string | null | undefined) {
  if (!value || value.includes('\\') || value.includes('\r') || value.includes('\n')) return '';
  return /^\/(?:home|account|weekly-plan-center|sample-capture\/[^/?#]+)(?:\?|$)/.test(value) ? value : '';
}
export function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
export function meaningfulDraft(row: Record<string, unknown>) { return ['processName', 'model', 'seconds', 'recommendedSeconds', 'measuredMilliseconds', 'outerPeelMm', 'innerPeelMm', 'insertionLengthMm', 'remark'].some(key => row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== ''); }
export const parameterLabels: Record<string, string> = { model: '连接器型号', positionLabel: '位置', outerPeelMm: '外剥皮 mm', innerPeelMm: '内剥皮 mm', insertionLengthMm: '插入长度 mm', processName: '工序名称', recommendedSeconds: '参考工时 秒', measuredMilliseconds: '实测工时 毫秒', seconds: '记录工时 秒', setupSeconds: '准备工时 秒', occurrences: '次数', timeBasis: '计时方式', stageGroup: '工序阶段', content: '内容', remark: '备注', materialName: '物料名称', specification: '规格', quantity: '数量', unit: '单位', wireSpec: '线材规格', wireColor: '线色', lengthMm: '长度 mm', tool: '工具', pressure: '压力', terminalModel: '端子型号', name: '物料名称', length: '长度', tolerance: '公差', position: '位置', category: '分类', severity: '关注程度', value: '记录值', unitLabel: '计量单位' };
export function displayPayload(payload: Record<string, unknown>): [string, string][] {
  return Object.entries(payload).filter(([key, value]) => !/(?:id|key|version|revision|hash)$/i.test(key) && !['source', 'processOrigin', 'publicationDecision', 'publishedEntityType'].includes(key) && value !== null && value !== undefined && value !== '' && typeof value !== 'object').map(([key, value]) => [parameterLabels[key] || key, ({ per_unit: '按件', per_batch: '按批', frontend: '前工序', backend: '后工序', finish: '包装 / 收尾' } as Record<string, string>)[String(value)] || String(value)]);
}
