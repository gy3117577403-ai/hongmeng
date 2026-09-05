import { QualityDataError, qualityText, qualityDate, type QualityAttachment } from './quality-data';

export const REFERENCE_STATUS = { DRAFT: '草稿', ACTIVE: '在用', INACTIVE: '停用' } as const;
export const REFERENCE_SOURCE = { EXPERIENCE: '经验记录', DOCUMENT: '依据文件', VERIFIED: '已验证' } as const;
export type ReferenceParameter = { group: 'DIMENSION' | 'MACHINE'; name: string; value: string; unit: string; tolerance: string; note: string };
export type ReferenceData = {
  wire: string; wireSize: string; wireUnit: string; insulation: string; equipment: string; mold: string;
  source: keyof typeof REFERENCE_SOURCE; basis: string; verifiedBy: string; verifiedAt: string; remark: string;
  parameters: ReferenceParameter[];
};
export type QualityReference = {
  id: string; code: string; kind: 'CRIMP'; terminalId: string | null; terminalName: string; manufacturer: string;
  title: string; status: keyof typeof REFERENCE_STATUS; data: ReferenceData; version: number;
  createdById: string; createdByName: string; createdAt: string; updatedAt: string;
  deletedAt: string | null; deleteReason: string | null; attachments: QualityAttachment[]; favorite?: boolean;
};
export type ReferenceInput = Pick<QualityReference, 'terminalId' | 'terminalName' | 'manufacturer' | 'title' | 'status' | 'data'>;
export type QualityTeamOption = { id: string; name: string; code: string; legacyTeamName: string | null };
export type TerminalOption = { id: string; specification: string; manufacturer: string | null; wireRange: string | null };
export function emptyReference(): ReferenceInput {
  return { terminalId: null, terminalName: '', manufacturer: '', title: '', status: 'DRAFT', data: {
    wire: '', wireSize: '', wireUnit: 'mm²', insulation: '', equipment: '', mold: '', source: 'EXPERIENCE',
    basis: '', verifiedBy: '', verifiedAt: '', remark: '',
    parameters: [{ group: 'DIMENSION', name: '导体压接高度', value: '', unit: 'mm', tolerance: '', note: '' }],
  } };
}
export function referenceInput(value: Record<string, unknown>): ReferenceInput {
  if (value.kind && value.kind !== 'CRIMP') throw new QualityDataError('当前支持端子压接参考数据');
  const terminalId = qualityText(value.terminalId, 120) || null;
  const terminalName = qualityText(value.terminalName, 160), manufacturer = qualityText(value.manufacturer, 160);
  if (!terminalName) throw new QualityDataError('请选择或填写端子型号');
  const status = value.status as keyof typeof REFERENCE_STATUS;
  if (!Object.hasOwn(REFERENCE_STATUS, status)) throw new QualityDataError('参考方案状态无效');
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new QualityDataError('参数内容格式不正确');
  const raw = value.data as Record<string, unknown>;
  const data = Object.fromEntries(['wire','wireSize','wireUnit','insulation','equipment','mold','basis','verifiedBy','verifiedAt','remark'].map(key => [key, qualityText(raw[key], key === 'remark' ? 4000 : 500)])) as Omit<ReferenceData, 'source' | 'parameters'>;
  const source = raw.source as keyof typeof REFERENCE_SOURCE;
  if (!Object.hasOwn(REFERENCE_SOURCE, source)) throw new QualityDataError('资料来源无效');
  if (data.wireSize && (!/^\d+(\.\d{1,6})?$/.test(data.wireSize) || (data.wireUnit === 'AWG' ? Number(data.wireSize) < 0 || !Number.isInteger(Number(data.wireSize)) : Number(data.wireSize) <= 0) || Number(data.wireSize) > 1000000)) throw new QualityDataError('线材规格数值无效，mm² 须大于零，AWG 须为非负整数');
  if (data.wireSize && !['mm²','AWG'].includes(data.wireUnit)) throw new QualityDataError('请选择线材规格单位');
  if (data.verifiedAt) qualityDate(data.verifiedAt);
  if (source === 'VERIFIED' && (!data.verifiedBy || !data.verifiedAt || !data.basis)) throw new QualityDataError('已验证资料须填写验证人、时间和依据');
  if (source === 'DOCUMENT' && !data.basis) throw new QualityDataError('请填写依据文件名称或编号');
  if (!Array.isArray(raw.parameters) || raw.parameters.length > 80) throw new QualityDataError('一套方案最多 80 个参数');
  const parameters = raw.parameters.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new QualityDataError('参数行格式不正确');
    const p = item as Record<string, unknown>;
    if (p.group !== 'DIMENSION' && p.group !== 'MACHINE') throw new QualityDataError('参数分类无效');
    const row = Object.fromEntries(['name','value','unit','tolerance','note'].map(key => [key, qualityText(p[key], key === 'note' ? 500 : 160)])) as Omit<ReferenceParameter,'group'>;
    if (row.value && (!row.name || !row.unit)) throw new QualityDataError('已填参数须有名称和单位（机器可选刻度 / 档位）');
    if (p.group === 'DIMENSION' && row.value && (!/^\d+(\.\d{1,6})?$/.test(row.value) || Number(row.value) <= 0 || Number(row.value) > 1000000)) throw new QualityDataError('压接尺寸须为大于零的数值');
    return { ...row, group: p.group } as ReferenceParameter;
  }).filter(p => p.value);
  if (!parameters.length) throw new QualityDataError('请填写至少一个压接尺寸或机器参数');
  if (parameters.some(p => p.group === 'MACHINE') && !data.equipment) throw new QualityDataError('机器参数须注明适用机台');
  if (status === 'ACTIVE' && (!data.wire && !data.wireSize)) throw new QualityDataError('启用方案前请补充适用线材');
  const title = qualityText(value.title, 160) || terminalName + ' · 压接参数';
  return { terminalId, terminalName, manufacturer, title, status, data: { ...data, source, parameters } };
}

export function referenceConditions(data: ReferenceData) {
  return [data.wire, data.wireSize ? data.wireSize + ' ' + data.wireUnit : '', data.equipment, data.mold].filter(Boolean).join(' · ') || '适用条件待补充';
}

// Verification belongs to the measured setup, not to the reference record forever.
export function resetStaleReferenceVerification(input: ReferenceInput, previous: ReferenceInput): ReferenceInput {
  if (input.data.source !== 'VERIFIED' || previous.data.source !== 'VERIFIED') return input;
  const setup = (value: ReferenceInput) => JSON.stringify({ terminalId: value.terminalId, terminalName: value.terminalName, manufacturer: value.manufacturer,
    ...Object.fromEntries(['wire','wireSize','wireUnit','insulation','equipment','mold','parameters'].map(key => [key, value.data[key as keyof ReferenceData]])) });
  if (setup(input) === setup(previous)) return input;
  if (input.data.verifiedAt !== previous.data.verifiedAt && input.data.verifiedBy && input.data.basis) return input;
  return { ...input, data: { ...input.data, source: 'EXPERIENCE', verifiedBy: '', verifiedAt: '' } };
}
