import QRCode from 'qrcode';
import type { SampleDataEntryDTO, SampleReviewStatusDTO, SampleTaskDTO } from '@/types';

export const SAMPLE_PRINT_TEMPLATE_VERSION = 'SP-02';

export type SamplePrintMode = 'blank' | 'current';
export type SamplePrintSectionKind = 'MATERIAL' | 'NOTICE';

export type SamplePrintRow = {
  id: string;
  cells: string[];
  status: string;
  blank: boolean;
};

export type SamplePrintSection = {
  kind: SamplePrintSectionKind;
  title: string;
  columns: string[];
  rows: SamplePrintRow[];
  startAt: number;
};

export type SamplePrintPage = {
  continuation: boolean;
  sections: SamplePrintSection[];
};

export type SamplePrintDocument = {
  mode: SamplePrintMode;
  templateVersion: string;
  printedAt: string;
  printedBy: string;
  captureUrl: string;
  stateLabel: string;
  sourceLabel: string;
  task: {
    id: string;
    code: string;
    customerName: string;
    productName: string;
    specification: string;
    sampleQuantity: string;
    dueDate: string;
    customerLevel: string;
    cancelled: boolean;
  };
  pages: SamplePrintPage[];
};

const REVIEW_STATUS_LABELS: Record<SampleReviewStatusDTO, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  CHANGES_REQUESTED: '待修改',
  APPROVED: '已通过',
  PUBLISHED: '已发布',
  VOIDED: '已作废',
};

const FIRST_PAGE_CAPACITY: Record<SamplePrintSectionKind, number> = {
  MATERIAL: 10,
  NOTICE: 7,
};

const CONTINUATION_CAPACITY: Record<SamplePrintSectionKind, number> = {
  MATERIAL: 14,
  NOTICE: 12,
};

const SECTION_ORDER: readonly SamplePrintSectionKind[] = ['MATERIAL', 'NOTICE'];

function text(value: unknown, max = 240): string {
  if (value === null || value === undefined) return '';
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
  return normalized
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function firstText(payload: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(payload[key]);
    if (value) return value;
  }
  return '';
}

function quantityWithUnit(payload: Record<string, unknown>): string {
  const quantity = firstText(payload, ['quantity', 'qty']);
  const unit = firstText(payload, ['unit', 'unitLabel']);
  return [quantity, unit].filter(Boolean).join(' ');
}

function rowFromEntry(entry: SampleDataEntryDTO, sequence: number): SamplePrintRow {
  const payload = entry.payload || {};
  let cells: string[];
  switch (entry.kind) {
    case 'MATERIAL':
      cells = [
        firstText(payload, ['name', 'materialName']) || text(entry.label),
        firstText(payload, ['specification', 'model', 'materialSpecification', 'spec']),
        firstText(payload, ['length', 'lengthMm']),
        quantityWithUnit(payload),
        firstText(payload, ['position', 'positionLabel', 'usagePosition']),
      ];
      break;
    case 'NOTICE':
      cells = [
        [firstText(payload, ['category']), firstText(payload, ['severity', 'level'])].filter(Boolean).join(' / '),
        firstText(payload, ['content', 'notice']) || text(entry.label) || firstText(payload, ['remark']),
      ];
      break;
    default:
      cells = [text(entry.label), ''];
  }
  return {
    id: entry.id || `${entry.kind}-${sequence}`,
    cells,
    status: REVIEW_STATUS_LABELS[entry.reviewStatus] || text(entry.reviewStatus),
    blank: cells.every(cell => !cell),
  };
}

function blankRow(kind: SamplePrintSectionKind, index: number): SamplePrintRow {
  const cellCount = kind === 'NOTICE' ? 2 : 5;
  return {
    id: `blank-${kind}-${index}`,
    cells: Array.from({ length: cellCount }, () => ''),
    status: '',
    blank: true,
  };
}

function sectionDefinition(kind: SamplePrintSectionKind, rows: SamplePrintRow[], startAt = 1): SamplePrintSection {
  if (kind === 'MATERIAL') return { kind, title: '一、辅料规格', columns: ['辅料名称', '型号 / 规格', '长度', '数量 / 单位', '使用位置'], rows, startAt };
  return { kind, title: '二、注意事项', columns: ['分类 / 等级', '注意事项内容'], rows, startAt };
}

function rowsForKind(task: SampleTaskDTO, kind: SamplePrintSectionKind, mode: SamplePrintMode): SamplePrintRow[] {
  if (mode === 'blank') return [];
  return task.entries
    .filter(entry => entry.kind === kind && entry.reviewStatus !== 'VOIDED')
    .map(rowFromEntry);
}

function firstPageRows(kind: SamplePrintSectionKind, rows: SamplePrintRow[]): SamplePrintRow[] {
  const capacity = FIRST_PAGE_CAPACITY[kind];
  const result = rows.slice(0, capacity);
  while (result.length < capacity) result.push(blankRow(kind, result.length));
  return result;
}

function continuationPages(kind: SamplePrintSectionKind, rows: SamplePrintRow[]): SamplePrintPage[] {
  const overflow = rows.slice(FIRST_PAGE_CAPACITY[kind]);
  if (!overflow.length) return [];
  const capacity = CONTINUATION_CAPACITY[kind];
  const pages: SamplePrintPage[] = [];
  for (let offset = 0; offset < overflow.length; offset += capacity) {
    pages.push({ continuation: true, sections: [sectionDefinition(kind, overflow.slice(offset, offset + capacity), FIRST_PAGE_CAPACITY[kind] + offset + 1)] });
  }
  return pages;
}

function chinaDateTime(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

function taskStateLabel(task: SampleTaskDTO, mode: SamplePrintMode): string {
  if (task.status === 'CANCELLED') return '已取消 · 仅供追溯';
  if (mode === 'blank') return '空白标准模板';
  if (task.dataStatus === 'NEEDS_CHANGES') return '待修改';
  if (task.dataStatus === 'PENDING_REVIEW') return '待审核';
  if (task.dataStatus === 'PARTIALLY_PUBLISHED') return '部分已发布';
  if (task.dataStatus === 'PROCESSED') return '已处理';
  if (task.dataStatus === 'COLLECTING') return '草稿';
  if (task.status === 'COMPLETED') return '已完成';
  return '尚无服务端采集内容';
}

export function parseSamplePrintMode(value: unknown): SamplePrintMode {
  return value === 'blank' ? 'blank' : 'current';
}

export function samplePrintBackHref(value: unknown): string {
  if (value === 'execution') return '/production?branch=samples';
  if (value === 'materials') return '/workspace/warehouse?branch=samples';
  return '/weekly-plan-center?branch=samples';
}

export function samplePrintBaseUrl(configured: unknown, requestOrigin?: unknown): string {
  for (const candidate of [configured, requestOrigin, 'http://localhost:3000']) {
    const value = text(candidate, 500);
    if (!value || /[\r\n\\]/.test(value)) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      return url.origin;
    } catch {
      // Try the next safe source. APP_BASE_URL always has precedence when valid.
    }
  }
  return 'http://localhost:3000';
}

export function samplePrintRequestOrigin(headers: Headers): string | undefined {
  const rawHost = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim();
  if (!rawHost || !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(rawHost)) return undefined;
  const rawProtocol = (headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const protocol = rawProtocol === 'https' ? 'https' : 'http';
  return `${protocol}://${rawHost}`;
}

export async function samplePrintQrDataUrl(captureUrl: string): Promise<string> {
  return QRCode.toDataURL(captureUrl, {
    errorCorrectionLevel: 'Q',
    margin: 4,
    width: 1024,
    color: { dark: '#111111', light: '#ffffff' },
  });
}

export function buildSamplePrintDocument(
  task: SampleTaskDTO,
  options: {
    mode?: SamplePrintMode;
    baseUrl: string;
    printedAt?: Date;
    printedBy?: string | null;
  },
): SamplePrintDocument {
  const mode = options.mode || 'current';
  const rows = Object.fromEntries(SECTION_ORDER.map(kind => [kind, rowsForKind(task, kind, mode)])) as Record<SamplePrintSectionKind, SamplePrintRow[]>;
  const firstPage: SamplePrintPage = {
    continuation: false,
    sections: SECTION_ORDER.map(kind => sectionDefinition(kind, firstPageRows(kind, rows[kind]))),
  };
  const pages = [firstPage, ...SECTION_ORDER.flatMap(kind => continuationPages(kind, rows[kind]))];
  const productName = text(task.productName) || '未设置品名';
  return {
    mode,
    templateVersion: SAMPLE_PRINT_TEMPLATE_VERSION,
    printedAt: chinaDateTime(options.printedAt || new Date()),
    printedBy: text(options.printedBy) || '当前登录用户',
    captureUrl: `${samplePrintBaseUrl(options.baseUrl)}${task.captureUrl}`,
    stateLabel: taskStateLabel(task, mode),
    sourceLabel: mode === 'blank' ? '空白标准模板' : '仅包含服务器已保存内容；本机未同步内容不打印',
    task: {
      id: task.id,
      code: text(task.code),
      customerName: text(task.customerName),
      productName,
      specification: text(task.specification),
      sampleQuantity: task.sampleQuantity === null ? '—' : `${task.sampleQuantity} 件/套`,
      dueDate: text(task.dueDate) || '—',
      customerLevel: text(task.customerLevelLabel) || (text(task.customerLevelCode) ? `${text(task.customerLevelCode)}级` : '—'),
      cancelled: task.status === 'CANCELLED',
    },
    pages,
  };
}
