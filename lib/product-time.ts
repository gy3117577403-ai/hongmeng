import { Prisma } from '@prisma/client';
import type {
  ProductProcessTimeEntryDTO,
  ProductTimeProfileDTO,
  ProductTimeProfileStatus,
  ProcessStageGroup,
  ProcessTimeBasis,
} from '@/types';

export const productTimeProfileInclude = Prisma.validator<Prisma.ProductTimeProfileInclude>()({
  entries: {
    orderBy: { position: 'asc' },
    include: { processDefinition: true },
  },
  createdBy: { select: { id: true, username: true, displayName: true } },
  updatedBy: { select: { id: true, username: true, displayName: true } },
  publishedBy: { select: { id: true, username: true, displayName: true } },
});

export type ProductTimeProfileRecord = Prisma.ProductTimeProfileGetPayload<{
  include: typeof productTimeProfileInclude;
}>;

export type ProductTimeEntryInput = {
  processDefinitionId: string;
  position: number;
  sequenceGroup: number;
  timeBasis: ProcessTimeBasis;
  unitMilliseconds: number;
  actionMilliseconds: number | null;
  occurrences: number;
  setupMilliseconds: number;
  unitLabel: string;
  countsForEfficiency: boolean;
  remark: string | null;
};

export type ProductTimeEntryValidationResult =
  | { ok: true; entries: ProductTimeEntryInput[] }
  | { ok: false; error: string };

type RawProductTimeEntry = {
  processDefinitionId?: unknown;
  timeBasis?: unknown;
  unitSeconds?: unknown;
  occurrences?: unknown;
  setupSeconds?: unknown;
  unitLabel?: unknown;
  parallelWithPrevious?: unknown;
  countsForEfficiency?: unknown;
  remark?: unknown;
};

export function cleanProductTimeText(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

function millisecondsFromSeconds(value: unknown, label: string, allowBlank = false): number | null {
  if (allowBlank && (value === null || value === undefined || String(value).trim() === '')) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
    throw new Error(`${label}必须大于 0 秒且不超过 24 小时`);
  }
  return Math.round(seconds * 1000);
}

function nonnegativeMilliseconds(value: unknown, label: string): number {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) {
    throw new Error(`${label}必须是 0 到 86400 秒之间的数值`);
  }
  return Math.round(seconds * 1000);
}

export function validateProductTimeEntries(value: unknown): ProductTimeEntryValidationResult {
  if (!Array.isArray(value)) return { ok: false, error: '产品工时明细格式不正确' };
  if (value.length > 80) return { ok: false, error: '单个产品最多维护 80 道工序' };

  const entries: ProductTimeEntryInput[] = [];
  const definitionIds = new Set<string>();
  let sequenceGroup = 0;
  try {
    for (let index = 0; index < value.length; index += 1) {
      const raw = value[index] as RawProductTimeEntry;
      const processDefinitionId = cleanProductTimeText(raw?.processDefinitionId, 80);
      if (!processDefinitionId) return { ok: false, error: `第 ${index + 1} 行缺少工序` };
      if (definitionIds.has(processDefinitionId)) return { ok: false, error: `第 ${index + 1} 行工序重复` };
      definitionIds.add(processDefinitionId);

      const timeBasis: ProcessTimeBasis = raw?.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit';
      const standardMilliseconds = millisecondsFromSeconds(
        raw?.unitSeconds,
        `第 ${index + 1} 行${timeBasis === 'per_batch' ? '整批' : '单次'}标准工时`,
      );
      if (standardMilliseconds === null) {
        return { ok: false, error: `第 ${index + 1} 行缺少标准工时` };
      }
      const occurrences = timeBasis === 'per_batch' ? 1 : Number(raw?.occurrences ?? 1);
      if (!Number.isInteger(occurrences) || occurrences <= 0 || occurrences > 10_000) {
        return { ok: false, error: `第 ${index + 1} 行每套工序次数必须是 1-10000 的整数` };
      }
      const unitMilliseconds = timeBasis === 'per_unit'
        ? standardMilliseconds * occurrences
        : standardMilliseconds;
      if (!Number.isSafeInteger(unitMilliseconds) || unitMilliseconds > 86_400_000) {
        return { ok: false, error: `第 ${index + 1} 行单套该工序总工时不能超过 24 小时` };
      }
      sequenceGroup = index > 0 && raw?.parallelWithPrevious === true
        ? sequenceGroup
        : sequenceGroup + 1;

      entries.push({
        processDefinitionId,
        position: index + 1,
        sequenceGroup,
        timeBasis,
        unitMilliseconds,
        actionMilliseconds: timeBasis === 'per_unit' && occurrences > 1 ? standardMilliseconds : null,
        occurrences,
        setupMilliseconds: nonnegativeMilliseconds(raw?.setupSeconds, `第 ${index + 1} 行准备时间`),
        unitLabel: cleanProductTimeText(raw?.unitLabel, 20) || '套',
        countsForEfficiency: raw?.countsForEfficiency !== false,
        remark: cleanProductTimeText(raw?.remark, 300) || null,
      });
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '产品工时明细不正确' };
  }
  return { ok: true, entries };
}

function profileStatus(value: string): ProductTimeProfileStatus {
  if (value === 'published' || value === 'archived') return value;
  return 'draft';
}

export function productTimeTotalMilliseconds(entries: Array<{ unitMilliseconds: number }>): number {
  return entries.reduce((total, entry) => total + entry.unitMilliseconds, 0);
}

export function serializeProductTimeEntry(entry: ProductTimeProfileRecord['entries'][number]): ProductProcessTimeEntryDTO {
  const stageGroup = entry.processDefinition.stageGroup as ProcessStageGroup;
  return {
    id: entry.id,
    processDefinitionId: entry.processDefinitionId,
    processCode: entry.processDefinition.code,
    processName: entry.processDefinition.name,
    stageGroup: stageGroup === 'backend' || stageGroup === 'finish' ? stageGroup : 'frontend',
    position: entry.position,
    sequenceGroup: entry.sequenceGroup,
    timeBasis: entry.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
    unitMilliseconds: entry.unitMilliseconds,
    actionMilliseconds: entry.actionMilliseconds,
    occurrences: entry.occurrences,
    setupMilliseconds: entry.setupMilliseconds,
    unitLabel: entry.unitLabel,
    countsForEfficiency: entry.countsForEfficiency,
    remark: entry.remark,
  };
}

export function serializeProductTimeProfile(profile: ProductTimeProfileRecord): ProductTimeProfileDTO {
  return {
    id: profile.id,
    drawingLibraryItemId: profile.drawingLibraryItemId,
    version: profile.version,
    revision: profile.revision,
    status: profileStatus(profile.status),
    sourceType: profile.sourceType,
    remark: profile.remark,
    totalMillisecondsPerUnit: productTimeTotalMilliseconds(profile.entries),
    processCount: profile.entries.length,
    publishedAt: profile.publishedAt?.toISOString() || null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    createdBy: profile.createdBy,
    updatedBy: profile.updatedBy,
    publishedBy: profile.publishedBy,
    entries: profile.entries.map(serializeProductTimeEntry),
  };
}

export function productTimeStandardSnapshot(
  profile: Pick<ProductTimeProfileRecord, 'id' | 'version'>,
  entry: ProductTimeProfileRecord['entries'][number],
) {
  const usesActionCount = entry.timeBasis !== 'per_batch'
    && Boolean(entry.actionMilliseconds)
    && entry.occurrences > 1;
  return {
    standardTimeId: null,
    standardVersion: null,
    productTimeProfileId: profile.id,
    productTimeEntryId: entry.id,
    productTimeProfileVersion: profile.version,
    standardSource: 'product_profile',
    timeBasis: entry.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
    unitLabel: entry.unitLabel || '套',
    standardMillisecondsPerUnit: usesActionCount
      ? entry.actionMilliseconds as number
      : entry.unitMilliseconds,
    setupMilliseconds: entry.setupMilliseconds,
    unitsPerProduct: usesActionCount ? entry.occurrences : 1,
    countsForEfficiency: entry.countsForEfficiency,
  } as const;
}

export function legacyProcessStandardSnapshot(standard: {
  id: string;
  version: number;
  timeBasis: string;
  unitLabel: string;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  countsForEfficiency: boolean;
}, unitsPerProduct = 1) {
  return {
    standardTimeId: standard.id,
    standardVersion: standard.version,
    productTimeProfileId: null,
    productTimeEntryId: null,
    productTimeProfileVersion: null,
    standardSource: 'process_standard',
    timeBasis: standard.timeBasis,
    unitLabel: standard.unitLabel,
    standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
    setupMilliseconds: standard.setupMilliseconds,
    unitsPerProduct,
    countsForEfficiency: standard.countsForEfficiency,
  };
}
