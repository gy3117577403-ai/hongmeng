export const PRODUCT_TIME_SEQUENCE_HEADER = '工序顺序(系统)';

const encodedProcessHeaderPrefix = '__HM_PROCESS__';

const reservedHeaders = [
  '产品型号',
  '客户',
  '品名',
  '工时状态',
  '版本',
  PRODUCT_TIME_SEQUENCE_HEADER,
  '合计(秒)',
  '合计(分)',
  '报价工时(秒/套)',
  '报价工时(分/套)',
  '报价版本',
];

export type ProductTimeExcelDefinition = {
  id: string;
  name: string;
};

export type ProductTimeExcelEntry = {
  processDefinitionId: string;
};

export type ProductTimeExcelColumn = {
  definitionId: string;
  definitionName: string;
  occurrence: number;
  header: string;
};

export type ProductTimeExcelIdentity = {
  header: string;
  definitionId: string;
  occurrenceKey: string;
  position: number;
};

export type ProductTimeExcelIdentityEntry = {
  columnHeader: string;
  processDefinitionId: string;
  occurrenceKey?: string;
};

export type ProductTimeExcelIdentityResult<T> = {
  ok: true;
  entries: Array<T & { occurrenceKey?: string }>;
  metadataApplied: boolean;
  warning?: string;
} | {
  ok: false;
  error: string;
};

export function normalizeProductTimeExcelHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s　]+/g, '')
    .replace(/[（）]/g, match => match === '（' ? '(' : ')')
    .toLocaleLowerCase('zh-CN');
}

export function productTimeOccurrenceHeader(name: string, occurrence: number, occurrenceCount: number): string {
  return occurrenceCount > 1 ? `${name}#${occurrence}` : name;
}

function encodedProcessHeader(definitionId: string, occurrence: number): string {
  return `${encodedProcessHeaderPrefix}${encodeURIComponent(definitionId)}#${occurrence}`;
}

export function buildProductTimeExcelColumns(
  definitions: ProductTimeExcelDefinition[],
  profiles: Array<{ entries: ProductTimeExcelEntry[] }>,
): ProductTimeExcelColumn[] {
  const maximumOccurrences = new Map<string, number>();
  for (const profile of profiles) {
    const counts = new Map<string, number>();
    for (const entry of profile.entries) {
      counts.set(entry.processDefinitionId, (counts.get(entry.processDefinitionId) || 0) + 1);
    }
    for (const [definitionId, count] of counts) {
      maximumOccurrences.set(definitionId, Math.max(maximumOccurrences.get(definitionId) || 0, count));
    }
  }

  const candidateColumns = definitions.flatMap(definition => {
    const occurrenceCount = Math.max(1, maximumOccurrences.get(definition.id) || 0);
    return Array.from({ length: occurrenceCount }, (_, index) => ({
      definitionId: definition.id,
      definitionName: definition.name,
      occurrence: index + 1,
      header: productTimeOccurrenceHeader(definition.name, index + 1, occurrenceCount),
    }));
  });
  const normalizedReserved = new Set(reservedHeaders.map(normalizeProductTimeExcelHeader));
  const candidateCounts = new Map<string, number>();
  for (const column of candidateColumns) {
    const key = normalizeProductTimeExcelHeader(column.header);
    candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
  }
  return candidateColumns.map(column => {
    const normalizedHeader = normalizeProductTimeExcelHeader(column.header);
    if (
      !column.header.startsWith(encodedProcessHeaderPrefix)
      && !normalizedReserved.has(normalizedHeader)
      && (candidateCounts.get(normalizedHeader) || 0) === 1
    ) {
      return column;
    }
    return {
      ...column,
      header: encodedProcessHeader(column.definitionId, column.occurrence),
    };
  });
}

export function resolveProductTimeExcelColumn(
  header: unknown,
  definitions: ProductTimeExcelDefinition[],
): ProductTimeExcelColumn | null {
  const rawHeader = String(header ?? '').trim();
  const normalizedHeader = normalizeProductTimeExcelHeader(rawHeader);
  if (!normalizedHeader) return null;

  if (rawHeader.startsWith(encodedProcessHeaderPrefix)) {
    const encoded = rawHeader.slice(encodedProcessHeaderPrefix.length).match(/^(.*)#([1-9]\d*)$/);
    if (encoded) {
      let definitionId = '';
      try {
        definitionId = decodeURIComponent(encoded[1]);
      } catch {
        definitionId = '';
      }
      const definition = definitions.find(item => item.id === definitionId);
      if (definition) {
        return {
          definitionId: definition.id,
          definitionName: definition.name,
          occurrence: Number(encoded[2]),
          header: rawHeader,
        };
      }
    }
  }

  if (reservedHeaders.some(item => normalizeProductTimeExcelHeader(item) === normalizedHeader)) return null;

  const exact = definitions.find(definition => normalizeProductTimeExcelHeader(definition.name) === normalizedHeader);
  if (exact) {
    return {
      definitionId: exact.id,
      definitionName: exact.name,
      occurrence: 1,
      header: rawHeader,
    };
  }

  const suffix = rawHeader.match(/^(.*)#([1-9]\d*)$/);
  if (!suffix) return null;
  const definition = definitions.find(item => (
    normalizeProductTimeExcelHeader(item.name) === normalizeProductTimeExcelHeader(suffix[1])
  ));
  if (!definition) return null;
  return {
    definitionId: definition.id,
    definitionName: definition.name,
    occurrence: Number(suffix[2]),
    header: rawHeader,
  };
}

function repeatedDefinitionIds(entries: Array<{ processDefinitionId: string }>): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.processDefinitionId, (counts.get(entry.processDefinitionId) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([definitionId]) => definitionId));
}

function parseProductTimeExcelIdentities(rawMetadata: unknown): ProductTimeExcelIdentity[] | null {
  if (typeof rawMetadata !== 'string' || !rawMetadata.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMetadata);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const identities: ProductTimeExcelIdentity[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Partial<ProductTimeExcelIdentity>;
    const header = String(item.header ?? '').trim();
    const definitionId = String(item.definitionId ?? '').trim();
    const occurrenceKey = String(item.occurrenceKey ?? '').trim();
    const position = Number(item.position);
    if (!header || !definitionId || !occurrenceKey || !Number.isInteger(position) || position <= 0) return null;
    identities.push({ header, definitionId, occurrenceKey, position });
  }
  const headers = identities.map(item => item.header);
  const occurrenceKeys = identities.map(item => item.occurrenceKey);
  const positions = identities.map(item => item.position);
  if (
    new Set(headers).size !== headers.length
    || new Set(occurrenceKeys).size !== occurrenceKeys.length
    || new Set(positions).size !== positions.length
  ) return null;
  return identities;
}

export function restoreProductTimeExcelIdentities<T extends ProductTimeExcelIdentityEntry>(
  entries: T[],
  rawMetadata: unknown,
  options: { requiresStableIdentity?: boolean } = {},
): ProductTimeExcelIdentityResult<T> {
  const repeatedEntries = repeatedDefinitionIds(entries);
  const identities = parseProductTimeExcelIdentities(rawMetadata);
  if (!identities) {
    if (options.requiresStableIdentity || repeatedEntries.size) {
      return { ok: false, error: '重复工序缺少完整的工序实例身份信息，请重新导出模板后再导入' };
    }
    return {
      ok: true,
      entries,
      metadataApplied: false,
      ...(rawMetadata ? { warning: '工序身份信息无效，已按普通单实例表头顺序读取' } : {}),
    };
  }

  const repeatedMetadata = repeatedDefinitionIds(identities.map(item => ({ processDefinitionId: item.definitionId })));
  const requiresStrictIdentity = Boolean(options.requiresStableIdentity)
    || repeatedEntries.size > 0
    || repeatedMetadata.size > 0;
  const identityByHeader = new Map(identities.map(identity => [identity.header, identity]));
  const identityEntries = entries.map(entry => ({ entry, identity: identityByHeader.get(entry.columnHeader) || null }));
  const complete = identityEntries.every(item => (
    item.identity && item.identity.definitionId === item.entry.processDefinitionId
  )) && (!requiresStrictIdentity || identities.length === entries.length);
  if (!complete) {
    if (requiresStrictIdentity) {
      return { ok: false, error: '重复工序的实例身份与表头不一致，请勿改名或删除系统工序列' };
    }
    return {
      ok: true,
      entries,
      metadataApplied: false,
      warning: '工序身份信息与表头不一致，已按普通单实例表头顺序读取',
    };
  }

  const restored = [...identityEntries]
    .sort((left, right) => left.identity!.position - right.identity!.position)
    .map(item => ({
      ...item.entry,
      occurrenceKey: item.identity!.occurrenceKey,
    }));
  return { ok: true, entries: restored, metadataApplied: true };
}
