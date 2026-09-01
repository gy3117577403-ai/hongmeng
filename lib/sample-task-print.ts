import QRCode from 'qrcode';
import type { SampleDataEntryDTO, SampleReviewStatusDTO, SampleTaskDTO } from '@/types';

export const SAMPLE_PRINT_TEMPLATE_VERSION = 'SP-01';

export type SamplePrintMode = 'blank' | 'current';
export type SamplePrintSectionKind = 'PROCESS_TIME' | 'STRIPPING' | 'MATERIAL' | 'NOTICE';

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
    sourceOrderNo: string;
    sampleQuantity: string;
    dueDate: string;
    priority: string;
    customerLevel: string;
    assignees: string;
    planRemark: string;
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
  PROCESS_TIME: 5,
  STRIPPING: 1,
  MATERIAL: 6,
  NOTICE: 4,
};

const CONTINUATION_CAPACITY: Record<SamplePrintSectionKind, number> = {
  PROCESS_TIME: 18,
  STRIPPING: 14,
  MATERIAL: 14,
  NOTICE: 12,
};

const SECTION_ORDER: readonly SamplePrintSectionKind[] = ['PROCESS_TIME', 'STRIPPING', 'MATERIAL', 'NOTICE'];

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

function measuredSeconds(payload: Record<string, unknown>): string {
  const direct = firstText(payload, ['recommendedSeconds', 'standardSeconds', 'seconds', 'workSeconds']);
  if (direct) return direct;
  const measurements = payload.measurements;
  if (!Array.isArray(measurements)) return '';
  for (const item of measurements) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const value = text((item as Record<string, unknown>).value);
      if (value) return value;
    }
    const value = text(item);
    if (value) return value;
  }
  return '';
}

function quantityWithUnit(payload: Record<string, unknown>): string {
  const quantity = firstText(payload, ['quantity', 'qty']);
  const unit = firstText(payload, ['unit', 'unitLabel']);
  return [quantity, unit].filter(Boolean).join(' ');
}

function secondsFromMilliseconds(value: unknown): string {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '';
  return String(Math.round(milliseconds) / 1000).replace(/\.0+$/, '');
}

function draftSectionStatus(task: SampleTaskDTO): string {
  if (task.dataStatus === 'PENDING_REVIEW') return '待审核';
  if (task.dataStatus === 'NEEDS_CHANGES') return '待修改';
  if (task.dataStatus === 'PARTIALLY_PUBLISHED') return '部分已发布';
  if (task.dataStatus === 'PROCESSED') return '已处理';
  return '草稿';
}

function rowsFromDraftSection(task: SampleTaskDTO, kind: 'PROCESS_TIME' | 'STRIPPING'): SamplePrintRow[] | null {
  const section = task.sections.find(item => item.kind === kind);
  if (!section) return null;
  const rawRows = Array.isArray(section.payload.rows) ? section.payload.rows : [];
  const status = draftSectionStatus(task);
  return rawRows
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map((row, index) => {
      const payload = row as Record<string, unknown>;
      const id = text(payload.rowId) || `section-${kind}-${index}`;
      const cells = kind === 'PROCESS_TIME'
        ? [firstText(payload, ['processName']), secondsFromMilliseconds(payload.measuredMilliseconds)]
        : [
          firstText(payload, ['model']),
          firstText(payload, ['outerPeelMm']),
          firstText(payload, ['innerPeelMm']),
          firstText(payload, ['insertionLengthMm']),
        ];
      return { id, cells, status, blank: cells.every(cell => !cell) };
    })
    .filter(row => !row.blank);
}

function rowFromEntry(entry: SampleDataEntryDTO, sequence: number): SamplePrintRow {
  const payload = entry.payload || {};
  let cells: string[];
  switch (entry.kind) {
    case 'PROCESS_TIME':
      cells = [
        firstText(payload, ['processName', 'name']) || text(entry.label),
        measuredSeconds(payload),
      ];
      break;
    case 'STRIPPING':
      cells = [
        firstText(payload, ['model', 'connectorModel']) || text(entry.label),
        firstText(payload, ['outerPeelMm', 'outerStripMm']),
        firstText(payload, ['innerPeelMm', 'innerStripMm']),
        firstText(payload, ['insertionLengthMm', 'insertionMm']),
      ];
      break;
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
  const cellCount = kind === 'PROCESS_TIME' || kind === 'NOTICE' ? 2 : kind === 'STRIPPING' ? 4 : 5;
  return {
    id: `blank-${kind}-${index}`,
    cells: Array.from({ length: cellCount }, () => ''),
    status: '',
    blank: true,
  };
}

function sectionDefinition(kind: SamplePrintSectionKind, rows: SamplePrintRow[], startAt = 1): SamplePrintSection {
  if (kind === 'PROCESS_TIME') return { kind, title: '一、工序与工时', columns: ['工序', '实测工时（秒/件）'], rows, startAt };
  if (kind === 'STRIPPING') return { kind, title: '二、剥皮参数', columns: ['型号', '外剥（mm）', '内剥（mm）', '入长（mm）'], rows, startAt };
  if (kind === 'MATERIAL') return { kind, title: '三、辅料规格', columns: ['辅料名称', '型号 / 规格', '长度', '数量 / 单位', '使用位置'], rows, startAt };
  return { kind, title: '四、注意事项', columns: ['分类 / 等级', '注意事项内容'], rows, startAt };
}

function rowsForKind(task: SampleTaskDTO, kind: SamplePrintSectionKind, mode: SamplePrintMode): SamplePrintRow[] {
  if (mode === 'blank') return [];
  if (kind === 'PROCESS_TIME' || kind === 'STRIPPING') {
    const sectionRows = rowsFromDraftSection(task, kind);
    if (sectionRows !== null) return sectionRows;
  }
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
      sourceOrderNo: text(task.sourceOrderNo) || '—',
      sampleQuantity: task.sampleQuantity === null ? '—' : `${task.sampleQuantity} 件/套`,
      dueDate: text(task.dueDate) || '—',
      priority: String(task.priority),
      customerLevel: text(task.customerLevelLabel) || (text(task.customerLevelCode) ? `${text(task.customerLevelCode)}级` : '—'),
      assignees: task.assignees.map(item => text(item.name)).filter(Boolean).join('、') || '—',
      planRemark: text(task.planRemark, 800),
      cancelled: task.status === 'CANCELLED',
    },
    pages,
  };
}
