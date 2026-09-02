import { drawingLibraryKey, invalidSpecificationReason } from '@/lib/drawing-library';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';

export const SAMPLE_PLAN_IMPORT_HEADERS = [
  '客户名称',
  '产品名称',
  '型号/规格',
  '客户等级',
  '样品数量',
  '计划日期',
  '图纸库编号（选填）',
] as const;

export type SamplePlanImportStatus = 'REUSE' | 'CREATE' | 'CONFIRM' | 'BLOCKED';

export type SamplePlanImportCandidate = {
  id: string;
  libraryKey: string;
  customerName: string;
  productName: string | null;
  specification: string;
  score?: number;
};

export type SamplePlanImportRow = {
  rowNumber: number;
  customerName: string;
  productName: string;
  specification: string;
  customerLevelCode: string;
  sampleQuantity: number;
  dueDate: string;
  libraryKey: string;
  matchStatus: SamplePlanImportStatus;
  message: string;
  matchedItemId: string | null;
  candidates: SamplePlanImportCandidate[];
};

const HEADER_ALIASES: Record<(typeof SAMPLE_PLAN_IMPORT_HEADERS)[number], readonly string[]> = {
  客户名称: ['客户名称', '客户'],
  产品名称: ['产品名称', '品名'],
  '型号/规格': ['型号/规格', '型号规格', '产品规格', '规格'],
  客户等级: ['客户等级', '等级'],
  样品数量: ['样品数量', '数量'],
  计划日期: ['计划日期', '完成日期', '交期'],
  '图纸库编号（选填）': ['图纸库编号（选填）', '图纸库编号(选填)', '图纸库编号', '图纸库ID', '图纸库id'],
};

export function cleanImportText(value: unknown, max = 180): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function findSamplePlanHeaderRow(rows: unknown[][]): { index: number; columns: Record<string, number> } | null {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const values = (rows[index] || []).map(value => cleanImportText(value, 80));
    const columns: Record<string, number> = {};
    for (const header of SAMPLE_PLAN_IMPORT_HEADERS) {
      const column = values.findIndex(value => HEADER_ALIASES[header].includes(value));
      if (column >= 0) columns[header] = column;
    }
    if (SAMPLE_PLAN_IMPORT_HEADERS.slice(0, 6).every(header => Number.isInteger(columns[header]))) {
      return { index, columns };
    }
  }
  return null;
}

export function parseSamplePlanDate(value: unknown): string | null {
  let year: number;
  let month: number;
  let day: number;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getUTCFullYear(); month = value.getUTCMonth() + 1; day = value.getUTCDate();
  } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = date.getUTCDate();
  } else {
    const match = cleanImportText(value, 40).match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
    if (!match) return null;
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parsePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(cleanImportText(value, 30));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function samplePlanFingerprint(row: Pick<SamplePlanImportRow, 'customerName' | 'specification' | 'customerLevelCode' | 'sampleQuantity' | 'dueDate'>) {
  return [
    drawingLibraryKey(row.customerName, row.specification).toLocaleLowerCase('zh-CN'),
    row.customerLevelCode.toUpperCase(),
    String(row.sampleQuantity),
    row.dueDate,
  ].join('|');
}

function normalizeForSimilarity(value: string) {
  return value.toLocaleUpperCase('zh-CN').replace(/[\s_\-—–/\\·.,，。()（）\[\]【】]+/g, '');
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

export function sampleSpecificationSimilarity(left: string, right: string): number {
  const a = normalizeForSimilarity(left);
  const b = normalizeForSimilarity(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  let common = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) common += 1;
  return (2 * common) / Math.max(1, leftPairs.size + rightPairs.size);
}

export function parseSamplePlanRow(
  raw: unknown[],
  rowNumber: number,
  columns: Record<string, number>,
): { row: Omit<SamplePlanImportRow, 'matchStatus' | 'message' | 'matchedItemId' | 'candidates'> | null; errors: string[] } {
  const value = (header: (typeof SAMPLE_PLAN_IMPORT_HEADERS)[number]) => raw[columns[header]];
  const customerName = cleanImportText(value('客户名称'));
  const productName = cleanImportText(value('产品名称'));
  const specification = cleanImportText(value('型号/规格'));
  const level = sampleCustomerLevel(value('客户等级'));
  const sampleQuantity = parsePositiveInteger(value('样品数量'));
  const dueDate = parseSamplePlanDate(value('计划日期'));
  const libraryKey = Number.isInteger(columns['图纸库编号（选填）']) ? cleanImportText(value('图纸库编号（选填）'), 240) : '';
  const errors: string[] = [];
  if (!customerName) errors.push('客户名称不能为空');
  if (!productName) errors.push('产品名称不能为空');
  if (!specification) errors.push('型号/规格不能为空');
  if (specification) {
    const reason = invalidSpecificationReason(specification);
    if (reason) errors.push(`型号/规格格式异常：${reason}`);
  }
  if (!level) errors.push('客户等级只能填写 A、B、C、D');
  if (sampleQuantity === null) errors.push('样品数量必须是大于 0 的整数');
  if (!dueDate) errors.push('计划日期必须是有效日期');
  const blank = !customerName && !productName && !specification && !cleanImportText(value('客户等级')) && !cleanImportText(value('样品数量')) && !cleanImportText(value('计划日期')) && !libraryKey;
  if (blank) return { row: null, errors: [] };
  if (errors.length || !level || sampleQuantity === null || !dueDate) return { row: null, errors };
  return {
    row: {
      rowNumber,
      customerName,
      productName,
      specification,
      customerLevelCode: level.code,
      sampleQuantity,
      dueDate,
      libraryKey,
    },
    errors,
  };
}
