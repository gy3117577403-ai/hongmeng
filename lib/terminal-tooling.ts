import type { Prisma } from '@prisma/client';
import { csv, parseCsv } from '@/lib/data-tools';

export const TERMINAL_TOOLING_POSITIONS = [
  'UPPER_OUTER',
  'UPPER_INNER',
  'LOWER_OUTER',
  'LOWER_INNER',
] as const;

export type TerminalToolingPosition = typeof TERMINAL_TOOLING_POSITIONS[number];

export const TERMINAL_TOOLING_POSITION_LABELS: Record<TerminalToolingPosition, string> = {
  UPPER_OUTER: '上外刀',
  UPPER_INNER: '上内刀',
  LOWER_OUTER: '下外刀',
  LOWER_INNER: '下内刀',
};

const POSITION_SET = new Set<string>(TERMINAL_TOOLING_POSITIONS);

export type TerminalToolingSupplyInput = {
  supplierName?: unknown;
  supplierSku?: unknown;
  productUrl?: unknown;
  remark?: unknown;
};

export type ParsedTerminalToolingSupply = {
  supplierName: string;
  supplierSku: string | null;
  productUrl: string | null;
  remark: string | null;
};

export type ParsedTerminalToolingTerminal = {
  specification: string;
  manufacturer: string | null;
  normalizedKey: string;
  aliases: string[];
  wireRange: string | null;
  material: string | null;
  plating: string | null;
  remark: string | null;
  isActive: boolean;
  lockVersion: number | null;
  supplierLinks: ParsedTerminalToolingSupply[];
};

export type ParsedTerminalToolingBlade = {
  model: string;
  manufacturer: string | null;
  normalizedKey: string;
  compatiblePositions: TerminalToolingPosition[];
  specification: string | null;
  dimensionA: string | null;
  dimensionB: string | null;
  dimensionUnit: string | null;
  material: string | null;
  hardness: string | null;
  remark: string | null;
  isActive: boolean;
  lockVersion: number | null;
  supplierLinks: ParsedTerminalToolingSupply[];
};

export type ParsedTerminalToolingSetupPosition = {
  position: TerminalToolingPosition;
  bladeId: string;
  remark: string | null;
};

export type ParsedTerminalToolingSetup = {
  terminalId: string;
  name: string | null;
  wireRange: string | null;
  equipment: string | null;
  mold: string | null;
  contextKey: string;
  remark: string | null;
  lockVersion: number | null;
  positions: ParsedTerminalToolingSetupPosition[];
  tags: string[];
};

export type ParseResult<T> = { data: T | null; errors: string[] };

export const terminalToolingTerminalInclude = {
  supplierLinks: {
    include: { supplier: true },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { setups: true } },
  setups: {
    where: { status: 'PUBLISHED' as const },
    select: { id: true },
  },
} satisfies Prisma.TerminalToolingTerminalInclude;

export const terminalToolingBladeInclude = {
  supplierLinks: {
    include: { supplier: true },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { setupPositions: true } },
} satisfies Prisma.TerminalToolingBladeInclude;

export const terminalToolingSetupInclude = {
  terminal: true,
  positions: {
    include: { blade: { include: terminalToolingBladeInclude } },
    orderBy: { createdAt: 'asc' as const },
  },
  tags: {
    include: { tag: true },
    orderBy: { tag: { label: 'asc' as const } },
  },
} satisfies Prisma.TerminalToolingSetupInclude;

export type TerminalToolingTerminalRecord = Prisma.TerminalToolingTerminalGetPayload<{
  include: typeof terminalToolingTerminalInclude;
}>;
export type TerminalToolingBladeRecord = Prisma.TerminalToolingBladeGetPayload<{
  include: typeof terminalToolingBladeInclude;
}>;
export type TerminalToolingSetupRecord = Prisma.TerminalToolingSetupGetPayload<{
  include: typeof terminalToolingSetupInclude;
}>;

function hasOwn(value: unknown, key: string): boolean {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, max = 200): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function longText(value: unknown, max = 2000): string {
  return String(value ?? '').trim().slice(0, max);
}

function nullable(value: unknown, max = 200): string | null {
  return text(value, max) || null;
}

function normalizeIdentity(value: unknown): string {
  return text(value, 300)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[×＊*]/g, 'x')
    .replace(/\s+/g, '');
}

export function terminalToolingTerminalKey(specification: unknown, manufacturer: unknown): string {
  return `${normalizeIdentity(specification)}|${normalizeIdentity(manufacturer) || '-'}`;
}

export function terminalToolingBladeKey(model: unknown, manufacturer: unknown): string {
  return `${normalizeIdentity(model)}|${normalizeIdentity(manufacturer) || '-'}`;
}

export function terminalToolingSupplierKey(name: unknown): string {
  return normalizeIdentity(name);
}

export function terminalToolingContextKey(input: {
  wireRange?: unknown;
  equipment?: unknown;
  mold?: unknown;
}): string {
  const parts = [input.wireRange, input.equipment, input.mold].map(value => normalizeIdentity(value) || '-');
  return parts.join('|');
}

function stringList(value: unknown, maxItems = 20): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[，,;；\n]/);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    const label = text(item, 80);
    const key = normalizeIdentity(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    values.push(label);
    if (values.length >= maxItems) break;
  }
  return values;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeIdentity(value);
  if (['true', '1', 'yes', 'y', '是', '启用', '正常'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', '否', '停用'].includes(normalized)) return false;
  return fallback;
}

function lockVersion(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decimalValue(value: unknown, label: string, errors: string[]): string | null {
  const normalized = text(value, 30);
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    errors.push(`${label}应为最多三位小数的非负数字`);
    return null;
  }
  if (Number(normalized) > 9999999) {
    errors.push(`${label}数值过大`);
    return null;
  }
  return normalized;
}

export function isSafeSupplierUrl(value: unknown): boolean {
  const candidate = text(value, 1000);
  if (!candidate) return true;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseTerminalToolingSupplies(value: unknown): ParseResult<ParsedTerminalToolingSupply[]> {
  const errors: string[] = [];
  const rows = Array.isArray(value) ? value.slice(0, 20) : [];
  const supplies: ParsedTerminalToolingSupply[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    const row = (raw && typeof raw === 'object' ? raw : {}) as TerminalToolingSupplyInput;
    const supplierName = text(row.supplierName, 120);
    const supplierSku = nullable(row.supplierSku, 120);
    const productUrl = nullable(row.productUrl, 1000);
    const remark = nullable(row.remark, 500);
    if (!supplierName && !supplierSku && !productUrl && !remark) continue;
    if (!supplierName) {
      errors.push('填写供应商货号或链接时必须填写供应商名称');
      continue;
    }
    if (productUrl && !isSafeSupplierUrl(productUrl)) {
      errors.push(`供应商“${supplierName}”的链接必须是 HTTP 或 HTTPS 地址`);
      continue;
    }
    const key = `${terminalToolingSupplierKey(supplierName)}|${normalizeIdentity(supplierSku)}|${normalizeIdentity(productUrl)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    supplies.push({ supplierName, supplierSku, productUrl, remark });
  }

  return { data: supplies, errors };
}

export function parseTerminalToolingTerminal(input: unknown): ParseResult<ParsedTerminalToolingTerminal> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const specification = text(source.specification, 120);
  const manufacturer = nullable(source.manufacturer, 120);
  if (!specification) errors.push('端子规格不能为空');
  const supplyResult = parseTerminalToolingSupplies(source.supplierLinks);
  errors.push(...supplyResult.errors);
  const data: ParsedTerminalToolingTerminal = {
    specification,
    manufacturer,
    normalizedKey: terminalToolingTerminalKey(specification, manufacturer),
    aliases: stringList(source.aliases),
    wireRange: nullable(source.wireRange, 120),
    material: nullable(source.material, 120),
    plating: nullable(source.plating, 120),
    remark: nullable(longText(source.remark, 2000), 2000),
    isActive: booleanValue(source.isActive, true),
    lockVersion: hasOwn(source, 'lockVersion') ? lockVersion(source.lockVersion) : null,
    supplierLinks: supplyResult.data || [],
  };
  if (hasOwn(source, 'lockVersion') && data.lockVersion === null) errors.push('端子数据版本无效，请刷新后重试');
  return { data: errors.length ? null : data, errors };
}

export function parseTerminalToolingBlade(input: unknown): ParseResult<ParsedTerminalToolingBlade> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const model = text(source.model, 120);
  const manufacturer = nullable(source.manufacturer, 120);
  if (!model) errors.push('刀片型号不能为空');
  const compatiblePositions = stringList(source.compatiblePositions, 4)
    .filter(position => POSITION_SET.has(position)) as TerminalToolingPosition[];
  if (!compatiblePositions.length) errors.push('至少选择一个适用刀位');
  const supplyResult = parseTerminalToolingSupplies(source.supplierLinks);
  errors.push(...supplyResult.errors);
  const data: ParsedTerminalToolingBlade = {
    model,
    manufacturer,
    normalizedKey: terminalToolingBladeKey(model, manufacturer),
    compatiblePositions,
    specification: nullable(source.specification, 160),
    dimensionA: decimalValue(source.dimensionA, '尺寸A', errors),
    dimensionB: decimalValue(source.dimensionB, '尺寸B', errors),
    dimensionUnit: nullable(source.dimensionUnit, 20) || 'mm',
    material: nullable(source.material, 120),
    hardness: nullable(source.hardness, 120),
    remark: nullable(longText(source.remark, 2000), 2000),
    isActive: booleanValue(source.isActive, true),
    lockVersion: hasOwn(source, 'lockVersion') ? lockVersion(source.lockVersion) : null,
    supplierLinks: supplyResult.data || [],
  };
  if (hasOwn(source, 'lockVersion') && data.lockVersion === null) errors.push('刀片数据版本无效，请刷新后重试');
  return { data: errors.length ? null : data, errors };
}

function parseSetupPositions(value: unknown, errors: string[]): ParsedTerminalToolingSetupPosition[] {
  const rows = Array.isArray(value) ? value : [];
  const positions: ParsedTerminalToolingSetupPosition[] = [];
  const seen = new Set<TerminalToolingPosition>();
  for (const raw of rows.slice(0, 8)) {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const position = text(row.position, 40) as TerminalToolingPosition;
    const bladeId = text(row.bladeId, 80);
    if (!position && !bladeId) continue;
    if (!POSITION_SET.has(position)) {
      errors.push('调模方案包含无效刀位');
      continue;
    }
    if (!bladeId) continue;
    if (seen.has(position)) {
      errors.push(`${TERMINAL_TOOLING_POSITION_LABELS[position]}重复配置`);
      continue;
    }
    seen.add(position);
    positions.push({ position, bladeId, remark: nullable(row.remark, 500) });
  }
  return positions;
}

export function parseTerminalToolingSetup(input: unknown): ParseResult<ParsedTerminalToolingSetup> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const terminalId = text(source.terminalId, 80);
  if (!terminalId) errors.push('必须选择端子');
  const positions = parseSetupPositions(source.positions, errors);
  const tags = stringList(source.tags, 20);
  const data: ParsedTerminalToolingSetup = {
    terminalId,
    name: nullable(source.name, 120),
    wireRange: nullable(source.wireRange, 120),
    equipment: nullable(source.equipment, 120),
    mold: nullable(source.mold, 120),
    contextKey: terminalToolingContextKey(source),
    remark: nullable(longText(source.remark, 3000), 3000),
    lockVersion: hasOwn(source, 'lockVersion') ? lockVersion(source.lockVersion) : null,
    positions,
    tags,
  };
  if (hasOwn(source, 'lockVersion') && data.lockVersion === null) errors.push('调模方案版本无效，请刷新后重试');
  return { data: errors.length ? null : data, errors };
}

export function validateTerminalToolingPublish(input: {
  terminalActive: boolean;
  positions: Array<{
    position: string;
    blade: { isActive: boolean; compatiblePositions: readonly string[] };
  }>;
}): string[] {
  const errors: string[] = [];
  if (!input.terminalActive) errors.push('端子已停用，不能发布调模方案');
  const map = new Map(input.positions.map(item => [item.position, item]));
  for (const position of TERMINAL_TOOLING_POSITIONS) {
    const entry = map.get(position);
    if (!entry) {
      errors.push(`${TERMINAL_TOOLING_POSITION_LABELS[position]}未配置`);
      continue;
    }
    if (!entry.blade.isActive) errors.push(`${TERMINAL_TOOLING_POSITION_LABELS[position]}所选刀片已停用`);
    if (!entry.blade.compatiblePositions.includes(position)) {
      errors.push(`${TERMINAL_TOOLING_POSITION_LABELS[position]}所选刀片不兼容该刀位`);
    }
  }
  return errors;
}

function serializeSupply(item: {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  productUrl: string | null;
  remark: string | null;
  supplier: { name: string };
}) {
  return {
    id: item.id,
    supplierId: item.supplierId,
    supplierName: item.supplier.name,
    supplierSku: item.supplierSku,
    productUrl: item.productUrl,
    remark: item.remark,
  };
}

export function serializeTerminalToolingTerminal(item: TerminalToolingTerminalRecord) {
  return {
    id: item.id,
    specification: item.specification,
    manufacturer: item.manufacturer,
    aliases: item.aliases,
    wireRange: item.wireRange,
    material: item.material,
    plating: item.plating,
    remark: item.remark,
    isActive: item.isActive,
    lockVersion: item.lockVersion,
    setupCount: item._count.setups,
    publishedSetupCount: item.setups.length,
    supplierLinks: item.supplierLinks.map(serializeSupply),
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeTerminalToolingBlade(item: TerminalToolingBladeRecord) {
  return {
    id: item.id,
    model: item.model,
    manufacturer: item.manufacturer,
    compatiblePositions: item.compatiblePositions,
    specification: item.specification,
    dimensionA: item.dimensionA?.toString() || null,
    dimensionB: item.dimensionB?.toString() || null,
    dimensionUnit: item.dimensionUnit,
    material: item.material,
    hardness: item.hardness,
    remark: item.remark,
    isActive: item.isActive,
    lockVersion: item.lockVersion,
    usageCount: item._count.setupPositions,
    supplierLinks: item.supplierLinks.map(serializeSupply),
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeTerminalToolingSetup(item: TerminalToolingSetupRecord) {
  return {
    id: item.id,
    terminalId: item.terminalId,
    terminal: {
      id: item.terminal.id,
      specification: item.terminal.specification,
      manufacturer: item.terminal.manufacturer,
      isActive: item.terminal.isActive,
    },
    name: item.name,
    wireRange: item.wireRange,
    equipment: item.equipment,
    mold: item.mold,
    contextKey: item.contextKey,
    version: item.version,
    status: item.status,
    remark: item.remark,
    lockVersion: item.lockVersion,
    publishedAt: item.publishedAt?.toISOString() || null,
    publishedBy: item.publishedBy,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    positions: item.positions.map(position => ({
      id: position.id,
      position: position.position,
      bladeId: position.bladeId,
      remark: position.remark,
      blade: serializeTerminalToolingBlade(position.blade),
    })),
    tags: item.tags.map(link => link.tag.label),
  };
}

export type TerminalToolingImportEntity = 'terminals' | 'blades';
export type TerminalToolingImportRow = Record<string, string> & {
  index: string;
  status: 'ready' | 'duplicate' | 'invalid' | 'skipped';
  reason: string;
};

const TERMINAL_HEADERS: Record<string, string> = {
  '端子规格': 'specification',
  '规格': 'specification',
  '制造商': 'manufacturer',
  '品牌': 'manufacturer',
  '别名': 'aliases',
  '适用线径': 'wireRange',
  '材质': 'material',
  '镀层': 'plating',
  '供应商': 'supplierName',
  '供应商货号': 'supplierSku',
  '供应商链接': 'productUrl',
  '备注': 'remark',
};

const BLADE_HEADERS: Record<string, string> = {
  '刀片型号': 'model',
  '型号': 'model',
  '制造商': 'manufacturer',
  '品牌': 'manufacturer',
  '适用刀位': 'compatiblePositions',
  '规格': 'specification',
  '尺寸A': 'dimensionA',
  '尺寸B': 'dimensionB',
  '单位': 'dimensionUnit',
  '材质': 'material',
  '硬度': 'hardness',
  '供应商': 'supplierName',
  '供应商货号': 'supplierSku',
  '供应商链接': 'productUrl',
  '备注': 'remark',
};

const POSITION_IMPORT_MAP: Record<string, TerminalToolingPosition> = {
  '上外刀': 'UPPER_OUTER',
  '上内刀': 'UPPER_INNER',
  '下外刀': 'LOWER_OUTER',
  '下内刀': 'LOWER_INNER',
  UPPER_OUTER: 'UPPER_OUTER',
  UPPER_INNER: 'UPPER_INNER',
  LOWER_OUTER: 'LOWER_OUTER',
  LOWER_INNER: 'LOWER_INNER',
};

function importInput(entity: TerminalToolingImportEntity, row: Record<string, string>) {
  const supplierLinks = row.supplierName || row.supplierSku || row.productUrl
    ? [{ supplierName: row.supplierName, supplierSku: row.supplierSku, productUrl: row.productUrl }]
    : [];
  if (entity === 'terminals') return { ...row, supplierLinks };
  const compatiblePositions = String(row.compatiblePositions || '')
    .split(/[，,;；/|\s]+/)
    .map(value => POSITION_IMPORT_MAP[value.trim()])
    .filter(Boolean);
  return { ...row, compatiblePositions, supplierLinks };
}

export function buildTerminalToolingImportPreview(options: {
  entity: TerminalToolingImportEntity;
  text: string;
  existingKeys: ReadonlySet<string>;
}) {
  const rows = parseCsv(options.text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { rows: [] as TerminalToolingImportRow[], recognizedHeaders: 0 };
  const headerMap = options.entity === 'terminals' ? TERMINAL_HEADERS : BLADE_HEADERS;
  const headers = rows[0].map(header => headerMap[text(header, 80)] || '');
  const recognizedHeaders = headers.filter(Boolean).length;
  const seen = new Set<string>();
  const preview = rows.slice(1).map((cells, rowIndex) => {
    const raw: Record<string, string> = {};
    headers.forEach((key, index) => {
      if (key) raw[key] = text(cells[index], 1000);
    });
    const empty = !Object.values(raw).some(Boolean);
    const parsed = options.entity === 'terminals'
      ? parseTerminalToolingTerminal(importInput(options.entity, raw))
      : parseTerminalToolingBlade(importInput(options.entity, raw));
    const key = parsed.data?.normalizedKey || '';
    let status: TerminalToolingImportRow['status'] = 'ready';
    let reason = '';
    if (empty) {
      status = 'skipped';
      reason = '空行';
    } else if (parsed.errors.length || !parsed.data) {
      status = 'invalid';
      reason = parsed.errors.join('；');
    } else if (options.existingKeys.has(key) || seen.has(key)) {
      status = 'duplicate';
      reason = '规格/型号与制造商组合重复';
    }
    if (key) seen.add(key);
    return {
      ...raw,
      index: String(rowIndex + 1),
      status,
      reason,
    } as TerminalToolingImportRow;
  });
  return { rows: preview, recognizedHeaders };
}

export function terminalToolingImportRowInput(entity: TerminalToolingImportEntity, row: TerminalToolingImportRow) {
  return importInput(entity, row);
}

export function terminalToolingCsv(entity: TerminalToolingImportEntity, items: Array<Record<string, unknown>>): string {
  const supplierColumn = (supplies: Array<Record<string, unknown>>, key: 'supplierName' | 'supplierSku' | 'productUrl') => (
    supplies
      .map(supply => text(supply[key], 1000))
      .filter(Boolean)
      .join('；')
  );
  if (entity === 'terminals') {
    return csv([
      ['端子规格', '制造商', '别名', '适用线径', '材质', '镀层', '供应商', '供应商货号', '供应商链接', '备注', '状态'],
      ...items.map(item => {
        const supplies = Array.isArray(item.supplierLinks) ? item.supplierLinks as Array<Record<string, unknown>> : [];
        return [item.specification, item.manufacturer, Array.isArray(item.aliases) ? item.aliases.join('；') : '', item.wireRange, item.material, item.plating, supplierColumn(supplies, 'supplierName'), supplierColumn(supplies, 'supplierSku'), supplierColumn(supplies, 'productUrl'), item.remark, item.isActive ? '正常' : '停用'];
      }),
    ]);
  }
  return csv([
    ['刀片型号', '制造商', '适用刀位', '规格', '尺寸A', '尺寸B', '单位', '材质', '硬度', '供应商', '供应商货号', '供应商链接', '备注', '状态'],
    ...items.map(item => {
      const supplies = Array.isArray(item.supplierLinks) ? item.supplierLinks as Array<Record<string, unknown>> : [];
      const positions = Array.isArray(item.compatiblePositions) ? item.compatiblePositions as string[] : [];
      return [item.model, item.manufacturer, positions.map(position => TERMINAL_TOOLING_POSITION_LABELS[position as TerminalToolingPosition] || position).join('；'), item.specification, item.dimensionA, item.dimensionB, item.dimensionUnit, item.material, item.hardness, supplierColumn(supplies, 'supplierName'), supplierColumn(supplies, 'supplierSku'), supplierColumn(supplies, 'productUrl'), item.remark, item.isActive ? '正常' : '停用'];
    }),
  ]);
}
