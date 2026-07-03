import type { ConnectorParameter, ConnectorParameterFile } from '@prisma/client';
import { csv, parseCsv } from '@/lib/data-tools';
import { ext, maxBytes, safeFilename } from '@/lib/validation';

export type ConnectorParameterInput = {
  rowNo?: unknown;
  model?: unknown;
  outerPeelMm?: unknown;
  innerPeelMm?: unknown;
  insertionLengthMm?: unknown;
  remark?: unknown;
  isHighlighted?: unknown;
};

export type ConnectorImportResult = {
  row: number;
  model: string;
  status: 'created' | 'skipped' | 'failed';
  message: string;
};

const headerMap: Record<string, keyof ConnectorParameterInput> = {
  序号: 'rowNo',
  型号: 'model',
  外剥皮mm: 'outerPeelMm',
  外剥皮: 'outerPeelMm',
  内剥皮mm: 'innerPeelMm',
  内剥皮: 'innerPeelMm',
  入长mm: 'insertionLengthMm',
  入长: 'insertionLengthMm',
  备注: 'remark',
  重点: 'isHighlighted',
  rowNo: 'rowNo',
  model: 'model',
  outerPeelMm: 'outerPeelMm',
  innerPeelMm: 'innerPeelMm',
  insertionLengthMm: 'insertionLengthMm',
  remark: 'remark',
  isHighlighted: 'isHighlighted',
};

const connectorFileTypes = new Set(['pdf', 'jpg', 'jpeg', 'png', 'csv', 'xlsx', 'xls']);

function text(value: unknown, max = 500) {
  const next = String(value ?? '').trim();
  return next ? next.slice(0, max) : null;
}

export function parseHighlighted(value: unknown) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (['是', 'true', '1', 'yes', 'y'].includes(raw)) return true;
  if (['否', 'false', '0', 'no', 'n'].includes(raw)) return false;
  return false;
}

function parseRowNo(value: unknown, errors: string[]) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    errors.push('序号必须是数字');
    return null;
  }
  return n;
}

export function parseConnectorParameterInput(input: ConnectorParameterInput, options: { partial?: boolean } = {}) {
  const errors: string[] = [];
  const data: {
    rowNo?: number | null;
    model?: string | null;
    outerPeelMm?: string | null;
    innerPeelMm?: string | null;
    insertionLengthMm?: string | null;
    remark?: string | null;
    isHighlighted?: boolean;
  } = {};
  const partial = !!options.partial;

  if (!partial || input.rowNo !== undefined) data.rowNo = parseRowNo(input.rowNo, errors);
  if (!partial || input.model !== undefined) data.model = text(input.model, 160);
  if (!partial || input.outerPeelMm !== undefined) data.outerPeelMm = text(input.outerPeelMm, 120);
  if (!partial || input.innerPeelMm !== undefined) data.innerPeelMm = text(input.innerPeelMm, 120);
  if (!partial || input.insertionLengthMm !== undefined) data.insertionLengthMm = text(input.insertionLengthMm, 120);
  if (!partial || input.remark !== undefined) data.remark = text(input.remark, 800);
  if (!partial || input.isHighlighted !== undefined) data.isHighlighted = parseHighlighted(input.isHighlighted);

  const rowHasValue = [
    input.rowNo,
    input.model,
    input.outerPeelMm,
    input.innerPeelMm,
    input.insertionLengthMm,
    input.remark,
  ].some(value => String(value ?? '').trim());

  if (!partial && !rowHasValue) errors.push('整行不能完全为空');
  return { data, errors, empty: !rowHasValue };
}

export function serializeConnectorParameter(item: ConnectorParameter) {
  return {
    id: item.id,
    rowNo: item.rowNo,
    model: item.model,
    outerPeelMm: item.outerPeelMm,
    innerPeelMm: item.innerPeelMm,
    insertionLengthMm: item.insertionLengthMm,
    remark: item.remark,
    isHighlighted: item.isHighlighted,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() || null,
  };
}

export function serializeConnectorParameterFile(item: ConnectorParameterFile) {
  return {
    id: item.id,
    originalName: item.originalName,
    displayName: item.displayName,
    mimeType: item.mimeType,
    fileType: item.fileType,
    fileSize: item.fileSize,
    uploadedBy: item.uploadedBy,
    createdAt: item.createdAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() || null,
    downloadUrl: `/api/connector-parameter-files/${item.id}/download`,
  };
}

export function parseDelimited(textValue: string) {
  const normalized = textValue.replace(/^\uFEFF/, '').trim();
  if (!normalized) return [];
  const firstLine = normalized.split(/\r?\n/)[0] || '';
  if (firstLine.includes('\t')) {
    return normalized
      .split(/\r?\n/)
      .map(line => line.split('\t').map(cell => cell.trim()))
      .filter(row => row.some(Boolean));
  }
  return parseCsv(normalized);
}

export function rowToConnectorInput(headers: string[], row: string[]) {
  const input: ConnectorParameterInput = {};
  headers.forEach((header, index) => {
    const key = headerMap[header.trim()];
    if (key) input[key] = row[index] ?? '';
  });
  return input;
}

export function connectorParameterCsv(items: ConnectorParameter[]) {
  return csv([
    ['序号', '型号', '外剥皮mm', '内剥皮mm', '入长mm', '备注', '重点', '创建时间', '更新时间'],
    ...items.map(item => [
      item.rowNo ?? '',
      item.model ?? '',
      item.outerPeelMm ?? '',
      item.innerPeelMm ?? '',
      item.insertionLengthMm ?? '',
      item.remark ?? '',
      item.isHighlighted ? '是' : '否',
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
    ]),
  ]);
}

export function connectorTemplateCsv() {
  return csv([['序号', '型号', '外剥皮mm', '内剥皮mm', '入长mm', '备注', '重点']]);
}

export function connectorFileType(name: string, mime = '') {
  const e = ext(name);
  if (e === 'jpeg') return 'jpg';
  if (connectorFileTypes.has(e)) return e;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/csv') return 'csv';
  return 'unknown';
}

export function validateConnectorFile(name: string, size: number) {
  const fileType = connectorFileType(name);
  if (fileType === 'unknown') return '仅支持 PDF、JPG、PNG、CSV、XLSX、XLS 原始资料';
  if (size <= 0) return '文件为空';
  if (size > maxBytes()) return `单文件不能超过 ${process.env.MAX_UPLOAD_SIZE_MB || 50}MB`;
  return null;
}

export function connectorObjectKey(filename: string, uuid: string, date = new Date()) {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `connector-parameters/source-files/${day}/${uuid}-${safeFilename(filename)}`;
}
