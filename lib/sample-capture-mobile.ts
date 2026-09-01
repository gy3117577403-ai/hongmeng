import type { SampleDataEntryDTO } from '@/types';

export const SAMPLE_PROCESS_MIN_ROWS = 5;
export const SAMPLE_STRIPPING_MIN_ROWS = 1;
export const SAMPLE_SECTION_MAX_ROWS = 50;

export type ProcessDraftRow = {
  rowId: string;
  processDefinitionId: string;
  processName: string;
  seconds: string;
  source: 'OFFICIAL' | 'PROPOSED';
};

export type StrippingDraftRow = {
  rowId: string;
  model: string;
  outerPeelMm: string;
  innerPeelMm: string;
  insertionLengthMm: string;
  /** Kept for legacy records; the focused mobile editor intentionally hides it. */
  positionLabel?: string;
  remark?: string;
};

export type SampleSectionEnvelope = {
  id?: string;
  kind: 'PROCESS_TIME' | 'STRIPPING';
  revision: number;
  payload?: { rows?: unknown[] } | null;
  uiState?: Record<string, unknown> | null;
  updatedAt?: string | null;
};

function randomId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createProcessRow(): ProcessDraftRow {
  return {
    rowId: randomId('process-row'),
    processDefinitionId: '',
    processName: '',
    seconds: '',
    source: 'PROPOSED',
  };
}

export function createStrippingRow(): StrippingDraftRow {
  return {
    rowId: randomId('stripping-row'),
    model: '',
    outerPeelMm: '',
    innerPeelMm: '',
    insertionLengthMm: '',
  };
}

export function createProcessRows(count = SAMPLE_PROCESS_MIN_ROWS) {
  return Array.from({ length: Math.max(SAMPLE_PROCESS_MIN_ROWS, Math.min(SAMPLE_SECTION_MAX_ROWS, count)) }, createProcessRow);
}

export function createStrippingRows(count = SAMPLE_STRIPPING_MIN_ROWS) {
  return Array.from({ length: Math.max(SAMPLE_STRIPPING_MIN_ROWS, Math.min(SAMPLE_SECTION_MAX_ROWS, count)) }, createStrippingRow);
}

function text(value: unknown) {
  return value == null ? '' : String(value);
}

function visibleRowCount(uiState: Record<string, unknown> | null | undefined, minimum: number, meaningful: number) {
  const requested = Number(uiState?.visibleRowCount || 0);
  return Math.max(minimum, meaningful, Math.min(SAMPLE_SECTION_MAX_ROWS, Number.isFinite(requested) ? requested : 0));
}

export function hydrateProcessRows(
  section: SampleSectionEnvelope | null | undefined,
  legacyEntries: SampleDataEntryDTO[] = [],
) {
  const rawRows = Array.isArray(section?.payload?.rows)
    ? section!.payload!.rows!
    : legacyEntries.filter(entry => entry.kind === 'PROCESS_TIME').map(entry => ({
      rowId: entry.id,
      processDefinitionId: entry.payload.processDefinitionId,
      processName: entry.payload.processName,
      seconds: entry.payload.recommendedSeconds,
      source: entry.payload.processDefinitionId ? 'OFFICIAL' : 'PROPOSED',
    }));
  const rows: ProcessDraftRow[] = rawRows.slice(0, SAMPLE_SECTION_MAX_ROWS).map((value, index) => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const processDefinitionId = text(row.processDefinitionId);
    const measuredMilliseconds = Number(row.measuredMilliseconds);
    const measuredSeconds = Number.isFinite(measuredMilliseconds) && measuredMilliseconds > 0
      ? String(measuredMilliseconds / 1000)
      : text(row.seconds ?? row.recommendedSeconds);
    return {
      rowId: text(row.rowId || row.id) || randomId(`process-${index + 1}`),
      processDefinitionId,
      processName: text(row.processName || row.name),
      seconds: measuredSeconds,
      source: (row.processOrigin === 'MASTER' || row.source === 'OFFICIAL' || processDefinitionId ? 'OFFICIAL' : 'PROPOSED') as ProcessDraftRow['source'],
    };
  });
  const count = visibleRowCount(section?.uiState, section ? 1 : SAMPLE_PROCESS_MIN_ROWS, rows.length);
  while (rows.length < count) rows.push(createProcessRow());
  return rows;
}

export function hydrateStrippingRows(
  section: SampleSectionEnvelope | null | undefined,
  legacyEntries: SampleDataEntryDTO[] = [],
) {
  const rawRows = Array.isArray(section?.payload?.rows)
    ? section!.payload!.rows!
    : legacyEntries.filter(entry => entry.kind === 'STRIPPING').map(entry => ({
      rowId: entry.id,
      ...entry.payload,
    }));
  const rows: StrippingDraftRow[] = rawRows.slice(0, SAMPLE_SECTION_MAX_ROWS).map((value, index) => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      rowId: text(row.rowId || row.id) || randomId(`stripping-${index + 1}`),
      model: text(row.model),
      outerPeelMm: text(row.outerPeelMm),
      innerPeelMm: text(row.innerPeelMm),
      insertionLengthMm: text(row.insertionLengthMm),
      positionLabel: text(row.positionLabel) || undefined,
      remark: text(row.remark) || undefined,
    };
  });
  const count = visibleRowCount(section?.uiState, SAMPLE_STRIPPING_MIN_ROWS, rows.length);
  while (rows.length < count) rows.push(createStrippingRow());
  return rows;
}

export function processRowHasContent(row: ProcessDraftRow) {
  return Boolean(row.processName.trim() || row.processDefinitionId.trim() || row.seconds.trim());
}

export function strippingRowHasContent(row: StrippingDraftRow) {
  return Boolean(
    row.model.trim()
    || row.outerPeelMm.trim()
    || row.innerPeelMm.trim()
    || row.insertionLengthMm.trim()
    || row.positionLabel?.trim()
    || row.remark?.trim(),
  );
}

function isPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function validateProcessRows(rows: ProcessDraftRow[]) {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    if (!processRowHasContent(row)) continue;
    if (!row.processName.trim()) errors[row.rowId] = '请选择或输入工序';
    else if (!row.seconds.trim()) errors[row.rowId] = '请填写实测工时';
    else if (!isPositiveNumber(row.seconds)) errors[row.rowId] = '工时必须大于 0';
  }
  return errors;
}

export function validateStrippingRows(rows: StrippingDraftRow[]) {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    if (!strippingRowHasContent(row)) continue;
    if (!row.model.trim()) {
      errors[row.rowId] = '填写尺寸时必须填写型号';
      continue;
    }
    const dimensions = [row.outerPeelMm, row.innerPeelMm, row.insertionLengthMm];
    if (!dimensions.some(value => value.trim())) {
      errors[row.rowId] = '至少填写一个剥皮尺寸';
      continue;
    }
    if (dimensions.some(value => value.trim() && !isNonNegativeNumber(value))) {
      errors[row.rowId] = '尺寸必须是大于或等于 0 的数字';
    }
  }
  return errors;
}

export function serializeProcessRows(rows: ProcessDraftRow[]) {
  return rows.filter(processRowHasContent).map((row, index) => ({
    rowId: row.rowId,
    position: index,
    processDefinitionId: row.processDefinitionId || null,
    processName: row.processName.trim(),
    processOrigin: row.processDefinitionId ? 'MASTER' : 'PROPOSED',
    measuredMilliseconds: Math.round(Number(row.seconds) * 1000),
  }));
}

export function serializeStrippingRows(rows: StrippingDraftRow[]) {
  return rows.filter(strippingRowHasContent).map((row, index) => ({
    rowId: row.rowId,
    position: index,
    model: row.model.trim(),
    outerPeelMm: row.outerPeelMm.trim(),
    innerPeelMm: row.innerPeelMm.trim(),
    insertionLengthMm: row.insertionLengthMm.trim(),
    ...(row.positionLabel ? { positionLabel: row.positionLabel } : {}),
    ...(row.remark ? { remark: row.remark } : {}),
  }));
}

export function formatDraftTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
