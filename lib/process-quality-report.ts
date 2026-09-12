/** Shared reporting contract. A route step ID, not its label, identifies an inspection. */
export type ProcessQualityType = 'CRIMP' | 'CONTINUITY' | 'FINAL';
export type QualityResponsibility = {
  status: 'PENDING' | 'ASSIGNED';
  allocations: Array<{ employeeId: string; quantity: number; name?: string; employeeNo?: string }>;
};
export type ProcessQualityReport = {
  responsibility: QualityResponsibility;
  issue: string;
  note: string;
  evidenceIds: string[];
};
export const PROCESS_QUALITY_LABELS: Record<ProcessQualityType, string> = {
  CRIMP: '端子压检', CONTINUITY: '导通检验', FINAL: '成品检验',
};
export const PROCESS_QUALITY_ISSUES: Record<ProcessQualityType, string[]> = {
  CRIMP: ['压接外观', '端子变形', '漏压 / 错压', '其他'],
  CONTINUITY: ['断路', '短路', '错接', '接触不良', '其他'],
  FINAL: ['外观异常', '尺寸异常', '标识异常', '其他'],
};
export class ProcessQualityError extends Error {
  constructor(message: string, public status = 400, public code = 'PROCESS_QUALITY_INVALID') { super(message); this.name = 'ProcessQualityError'; }
}
export function processQualityType(name: string | null | undefined): ProcessQualityType | null {
  // Optional occurrence labels are deliberately narrow. “压接” and “检验设备准备” are ordinary processes.
  const normalized = (name || '').normalize('NFKC').trim().replace(/\s+/g, '');
  const match = normalized.match(/^(端子压接检验|端子压检|压接检验|压检|导通检验|导通测试|导通|成品检验|成检|终检|检验)(?:[·\-_/]?[ABab左右前后]端|\([^()]{1,30}\))?$/);
  if (!match) return null;
  if (['端子压接检验', '端子压检', '压接检验', '压检'].includes(match[1])) return 'CRIMP';
  return match[1].startsWith('导通') ? 'CONTINUITY' : 'FINAL';
}
export function emptyProcessQualityReport(): ProcessQualityReport {
  return { responsibility: { status: 'PENDING', allocations: [] }, issue: '', note: '', evidenceIds: [] };
}
export function qualityReportForQuantity(value: ProcessQualityReport | undefined, defectQty: number): ProcessQualityReport {
  const report = value || emptyProcessQualityReport();
  return defectQty > 0 ? report : { ...report, responsibility: { status: 'PENDING', allocations: [] } };
}
function text(value: unknown, length: number): string {
  if (value == null) return '';
  if (typeof value !== 'string' || value.trim().length > length) throw new ProcessQualityError('质量说明格式或长度不正确');
  return value.trim();
}
export function parseProcessQualityReport(value: unknown): ProcessQualityReport | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ProcessQualityError('质量信息格式不正确');
  const body = value as Record<string, unknown>;
  const raw = body.responsibility as Record<string, unknown> | undefined;
  if (!raw || !['PENDING', 'ASSIGNED'].includes(String(raw.status)) || !Array.isArray(raw.allocations) || raw.allocations.length > 20) throw new ProcessQualityError('请选择责任人，或选择责任待确认');
  const allocations = raw.allocations.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new ProcessQualityError('责任分配格式不正确');
    const row = item as Record<string, unknown>, employeeId = text(row.employeeId, 100), quantity = Number(row.quantity);
    if (!employeeId || !Number.isSafeInteger(quantity) || quantity <= 0) throw new ProcessQualityError('每名责任人的不良数量须为正整数');
    return { employeeId, quantity };
  }).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  if (new Set(allocations.map(row => row.employeeId)).size !== allocations.length) throw new ProcessQualityError('同一责任人不能重复选择');
  if (raw.status === 'PENDING' && allocations.length || raw.status === 'ASSIGNED' && !allocations.length) throw new ProcessQualityError('责任状态与人员分配不一致');
  if (!Array.isArray(body.evidenceIds) || body.evidenceIds.length > 6) throw new ProcessQualityError('每道工序最多上传 6 张质量照片');
  const evidenceIds = body.evidenceIds.map(id => text(id, 100));
  if (evidenceIds.some(id => !id) || new Set(evidenceIds).size !== evidenceIds.length) throw new ProcessQualityError('质量照片标识无效或重复');
  return { responsibility: { status: raw.status as QualityResponsibility['status'], allocations }, issue: text(body.issue, 80), note: text(body.note, 2000), evidenceIds: [...evidenceIds].sort() };
}
export function assertQualityResponsibility(report: ProcessQualityReport, defectQty: number) {
  const assigned = report.responsibility.allocations.reduce((sum, row) => sum + row.quantity, 0);
  if (report.responsibility.status === 'ASSIGNED' && assigned !== defectQty) throw new ProcessQualityError(`责任分配合计须等于本次不良数量 ${defectQty}`);
  if (defectQty === 0 && report.responsibility.status !== 'PENDING') throw new ProcessQualityError('没有不良时无需填写责任人');
}
export function qualityResponsibilityLabel(value: QualityResponsibility | null | undefined, defectQty: number) {
  if (!defectQty) return '无需填写';
  if (!value || value.status === 'PENDING') return '责任待确认';
  return value.allocations.map(row => `${row.name || row.employeeNo || '员工'}${value.allocations.length > 1 ? ` ${row.quantity}` : ''}`).join('、');
}
