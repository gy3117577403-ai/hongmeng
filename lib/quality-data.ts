/** Shared form definitions. Standards are supplied by the shop, never invented. */
export const QUALITY_DATA_TYPES = ['CRIMP', 'PULL', 'FINAL', 'CONTINUITY', 'FIRST', 'PATROL'] as const;
export const QUALITY_SCAN_TYPES = ['CRIMP', 'PULL', 'FINAL', 'CONTINUITY', 'FIRST'] as const;
export type QualityDataType = typeof QUALITY_DATA_TYPES[number];
export type QualityResult = 'PENDING' | 'PASS' | 'FAIL';
export const QUALITY_LABELS: Record<QualityDataType, string> = {
  CONTINUITY: '导通检验', CRIMP: '端子压检', PULL: '拉力测试', FINAL: '成品检验', FIRST: '首件检验', PATROL: '巡检报表',
};
export const RESULT_LABELS: Record<QualityResult, string> = { PENDING: '待判定', PASS: '合格', FAIL: '不合格' };
export const REVIEW_LABELS: Record<string, string> = { UNREVIEWED: '未复核', APPROVED: '已复核', RETURNED: '已退回' };
export const CONTEXT_FIELDS = [
  ['processName', '检验工序'], ['team', '班组'], ['workstation', '工位'],
  ['terminal', '端子型号'], ['wire', '线材规格'], ['materialLot', '物料批次 / 卷盘'],
  ['equipment', '生产设备'], ['mold', '模具编号'], ['instrument', '检验仪器'],
  ['method', '检验方式'], ['trigger', '检验原因'], ['standardRef', '检验依据 / 版本'],
  ['inspectedBy', '实际检验人'], ['inspectionQty', '本次检验数量'], ['sampleQty', '抽样数量'],
  ['defectQty', '不良数量'],
] as const;
export type QualityContextKey = typeof CONTEXT_FIELDS[number][0];
export type QualityContext = Record<QualityContextKey, string>;
export type QualityMeasurement = {
  sample: string; position: string; item: string; standard: string; lower: string; upper: string;
  value: string; unit: string; result: QualityResult; note: string;
};
export type QualityFormData = {
  mode: 'FORM' | 'FILE'; context: QualityContext; rows: QualityMeasurement[]; summary: string; teamId?: string;
  paper?: { result: QualityResult | null; area: string; archive?: boolean; dateEnd?: string };
};
export type QualityInspectionStep = { id: string; name: string; position?: number; routeId?: string };
export const isFirstInspectionProcess = (name: string) => /首件|首检/.test(name);
export type QualityOrder = {
  id: string; code: string; businessCode: string | null; sourceOrderNo: string | null;
  customerName: string | null; productName: string; specification: string | null;
  orderDate: string | null; stage: string; deletedAt?: string | null; quantity: number | null;
  planOrderId: string | null; batchId: string | null; batchNo: number | null; sourceLineNo: number | null;
  rootWorkOrderId: string | null; parentWorkOrderId: string | null;
  steps: QualityInspectionStep[];
};
export type QualityAttachment = { id: string; originalName: string; mimeType: string; size: number; sha256: string; createdAt: string; deletedAt: string | null; sortOrder?: number };
export type QualityRecord = {
  id: string; code: string; workOrderId: string | null; type: QualityDataType; title: string; inspectedAt: string;
  inspectionStepId?: string | null; inspectionStepSnapshot?: QualityInspectionStep | null;
  status: 'DRAFT' | 'SUBMITTED'; result: QualityResult; reviewStatus: string; version: number;
  templateVersion: number; data: QualityFormData; orderSnapshot: QualityOrder;
  createdById: string; createdByName: string; createdAt: string; updatedAt: string;
  sourceCompletionId?: string | null;
  reportSnapshot?: { completionId: string; routeId: string; stepId: string; position: number; processName: string; quantity: number; defectQty: number; goodQty: number; unit: string; quantityBasis: string; workDate: string; inspectedBy: string; issue: string; note: string } | null;
  responsibilityStatus?: string; responsibility?: import('./process-quality-report').QualityResponsibility | null;
  sourceQrCode: string | null; supersedesId: string | null; submittedAt: string | null;
  reviewedAt: string | null; reviewedByName: string | null; reviewNote: string | null;
  deletedAt: string | null; deleteReason: string | null; attachments: QualityAttachment[];
  revisions?: Array<{ id: string; version: number; action: string; reason: string; actorName: string; createdAt: string; snapshot: QualityRecord }>;
};
export type QualityActor = { id: string; name: string; canManage: boolean; canReview: boolean };
export class QualityDataError extends Error {
  constructor(message: string, public status = 400, public code = 'QUALITY_DATA_INVALID') { super(message); this.name = 'QualityDataError'; }
}
export function qualityText(value: unknown, max = 240): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new QualityDataError('文本字段格式不正确');
  const text = value.trim();
  if (text.length > max) throw new QualityDataError('填写内容超出允许长度');
  return text;
}
export function qualityType(value: unknown): QualityDataType {
  if (!QUALITY_DATA_TYPES.includes(value as QualityDataType)) throw new QualityDataError('请选择有效的检验类型');
  return value as QualityDataType;
}
export function beijingInput(value: string | Date = new Date()): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16) : '';
}
export function qualityDate(value: unknown): Date {
  const text = qualityText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(text)) throw new QualityDataError('检验时间格式不正确');
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : text + '+08:00';
  const date = new Date(zoned);
  const day = text.slice(0, 10);
  const calendar = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) throw new QualityDataError('检验日期不存在');
  if (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59) throw new QualityDataError('检验时间不正确');
  if (date.getTime() > Date.now() + 5 * 60000) throw new QualityDataError('检验时间不能晚于当前时间');
  return date;
}
function decimal(value: string): number | null {
  if (!value) return null;
  if (!/^-?\d+(\.\d{1,6})?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e9) throw new QualityDataError('测量数值最多保留六位小数，且须为有效数值');
  return Number(value);
}
export function measurementResult(row: QualityMeasurement): QualityResult {
  const lower = decimal(row.lower), upper = decimal(row.upper);
  if (lower !== null && upper !== null && lower > upper) throw new QualityDataError('标准下限不能大于上限');
  if (!row.item || !row.value) return 'PENDING';
  if (lower !== null || upper !== null) {
    if (!row.unit) throw new QualityDataError('有数值标准的项目必须填写单位');
    const value = decimal(row.value)!;
    return (lower !== null && value < lower) || (upper !== null && value > upper) ? 'FAIL' : 'PASS';
  }
  return row.result === 'FAIL' ? 'FAIL' : row.result === 'PASS' && row.standard ? 'PASS' : 'PENDING';
}
export function qualityForm(value: unknown): QualityFormData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QualityDataError('检验表单格式不正确');
  const input = value as Record<string, unknown>;
  const rawContext = input.context && typeof input.context === 'object' ? input.context as Record<string, unknown> : {};
  const context = Object.fromEntries(CONTEXT_FIELDS.map(([key]) => [key, qualityText(rawContext[key], 240)])) as QualityContext;
  for (const key of ['inspectionQty', 'sampleQty', 'defectQty'] as const) {
    if (context[key] && (!/^\d+$/.test(context[key]) || Number(context[key]) > 1000000000)) throw new QualityDataError('检验、抽样和不良数量须为非负整数');
  }
  if (context.inspectionQty && context.sampleQty && Number(context.sampleQty) > Number(context.inspectionQty)) throw new QualityDataError('抽样数量不能大于检验数量');
  const checkedQty = context.sampleQty || context.inspectionQty;
  if (context.defectQty && checkedQty && Number(context.defectQty) > Number(checkedQty)) throw new QualityDataError('不良数量不能大于实际检查数量');
  if (!Array.isArray(input.rows) || input.rows.length > 120) throw new QualityDataError('一份检验记录最多包含 120 项测量');
  const rows = input.rows.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new QualityDataError('测量行格式不正确');
    const source = raw as Record<string, unknown>;
    const row = Object.fromEntries(['sample','position','item','standard','lower','upper','value','unit','note'].map(key => [key, qualityText(source[key], key === 'note' || key === 'standard' ? 500 : 160)])) as unknown as QualityMeasurement;
    if (!['PASS','FAIL','PENDING'].includes(String(source.result))) throw new QualityDataError('检查结论无效');
    row.result = source.result as QualityResult;
    row.result = measurementResult(row);
    return row;
  });
  if (input.mode !== 'FORM' && input.mode !== 'FILE') throw new QualityDataError('填报方式无效');
  let paper: QualityFormData['paper'];
  if (input.paper !== undefined) {
    if (!input.paper || typeof input.paper !== 'object' || Array.isArray(input.paper)) throw new QualityDataError('纸质检验信息格式不正确');
    const p = input.paper as Record<string, unknown>;
    if (p.result != null && !['PENDING', 'PASS', 'FAIL'].includes(String(p.result))) throw new QualityDataError('检验结果无效');
    paper = { result: (p.result ?? null) as QualityResult | null, area: qualityText(p.area, 160) };
    if (p.archive !== undefined) {
      if (typeof p.archive !== 'boolean') throw new QualityDataError('归档方式无效');
      paper.archive = p.archive;
    }
    if (p.dateEnd) {
      const end = qualityText(p.dateEnd, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new QualityDataError('覆盖结束日期无效');
      qualityDate(end + 'T00:00');
      paper.dateEnd = end;
    }
    if (input.mode !== 'FILE') throw new QualityDataError('照片归档须使用文件模式');
  }
  return { mode: input.mode, context, rows, summary: qualityText(input.summary, 4000), teamId: qualityText(input.teamId, 120), ...(paper ? { paper } : {}) };
}
export function qualityResult(data: QualityFormData): QualityResult {
  if (data.paper?.archive) return 'PENDING';
  if (data.mode === 'FILE') return Number(data.context.defectQty || 0) > 0 ? 'FAIL' : data.paper?.result || 'PENDING';
  if (data.rows.some(row => row.result === 'FAIL') || Number(data.context.defectQty || 0) > 0) return 'FAIL';
  const measured = data.rows.filter(row => row.value);
  return measured.length && measured.every(row => row.result === 'PASS') ? 'PASS' : 'PENDING';
}
export function assertQualitySubmission(data: QualityFormData, attachments: number) {
  if (!data.paper?.archive && !data.context.inspectedBy) throw new QualityDataError('请填写实际检验人');
  if (data.mode === 'FILE') {
    if (!attachments) throw new QualityDataError('文件归档需至少上传一份附件');
  } else if (data.rows.some(row => row.value && !row.item) || (!data.rows.some(row => row.item && row.value) && !attachments)) {
    throw new QualityDataError('请填写至少一项检验结果或上传附件；已填结果须有项目名称');
  }
}
export function isPaperArchive(record: Pick<QualityRecord, 'type' | 'workOrderId' | 'data'>): boolean {
  return (record.type === 'FIRST' || record.type === 'PATROL') && !record.workOrderId && record.data.mode === 'FILE';
}
export function emptyQualityForm(type: QualityDataType, inspector = ''): QualityFormData {
  const context = Object.fromEntries(CONTEXT_FIELDS.map(([key]) => [key, key === 'inspectedBy' ? inspector : ''])) as QualityContext;
  const names: Record<QualityDataType, string[]> = {
    CRIMP: ['压接外观'], PULL: ['端子拉力', '端子型号核对'], CONTINUITY: ['导通结果'],
    FINAL: ['外观', '尺寸'], FIRST: ['首件外观'], PATROL: ['过程质量'],
  };
  return { mode: 'FORM', context, summary: '', rows: names[type].map(item => ({ sample: '1', position: '', item, standard: '', lower: '', upper: '', value: '', unit: item.includes('高度') || item.includes('宽度') || item === '尺寸' ? 'mm' : item === '端子拉力' ? 'N' : '', result: 'PENDING', note: '' })) };
}
export function assertQualityEdit(actor: QualityActor, record: { createdById: string; status: string; deletedAt: Date | string | null }) {
  if (record.deletedAt) throw new QualityDataError('记录在回收站中，请先恢复', 409);
  if (!actor.canManage && record.createdById !== actor.id) throw new QualityDataError('只能修改本人填写的记录', 403);
}
export function qualityActor(user: { id: string; displayName: string; username: string; access: { capabilities: readonly string[] } }): QualityActor {
  return { id: user.id, name: user.displayName || user.username, canManage: user.access.capabilities.includes('QUALITY_DATA:MANAGE'), canReview: user.access.capabilities.includes('QUALITY_DATA:APPROVE') };
}
