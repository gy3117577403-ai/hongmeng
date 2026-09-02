import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type ProcessDefinitionResolutionAction = 'CREATED' | 'REACTIVATED' | 'REUSED';

export class ProcessDefinitionResolutionError extends Error {
  constructor(
    message: string,
    public code: 'PROCESS_NAME_REQUIRED' | 'PROCESS_NAME_DUPLICATE' | 'PROCESS_NAME_AMBIGUOUS',
    public status = 409,
  ) {
    super(message);
  }
}

export function normalizeProcessDefinitionName(value: unknown) {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  const name = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new ProcessDefinitionResolutionError('请填写工序名称', 'PROCESS_NAME_REQUIRED', 400);
  return { name, nameKey: name.toLocaleLowerCase('zh-CN') };
}

function normalizedStageGroup(value: unknown) {
  return value === 'backend' || value === 'finish' ? value : 'frontend';
}

async function lockName(tx: Prisma.TransactionClient, nameKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-definition:${nameKey}`}))`;
}

async function matchingDefinitions(
  tx: Prisma.TransactionClient,
  nameKey: string,
  excludeId?: string,
) {
  const candidates = await tx.processDefinition.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ nameKey }, { nameKey: null }],
    },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  });
  return candidates.filter(candidate => {
    try {
      return normalizeProcessDefinitionName(candidate.name).nameKey === nameKey;
    } catch {
      return false;
    }
  });
}

export async function reserveUniqueProcessDefinitionName(
  tx: Prisma.TransactionClient,
  value: unknown,
  excludeId?: string,
) {
  const normalized = normalizeProcessDefinitionName(value);
  await lockName(tx, normalized.nameKey);
  const matches = await matchingDefinitions(tx, normalized.nameKey, excludeId);
  if (matches.length) {
    throw new ProcessDefinitionResolutionError('同名工序已经存在', 'PROCESS_NAME_DUPLICATE');
  }
  return normalized;
}

export async function resolveOrCreateProcessDefinition(
  tx: Prisma.TransactionClient,
  input: {
    name: unknown;
    stageGroup?: unknown;
    code?: string;
    sortOrder?: number;
  },
) {
  const normalized = normalizeProcessDefinitionName(input.name);
  await lockName(tx, normalized.nameKey);
  const matches = await matchingDefinitions(tx, normalized.nameKey);
  const active = matches.filter(item => item.isActive);
  if (active.length > 1 || (active.length === 0 && matches.length > 1)) {
    throw new ProcessDefinitionResolutionError(
      `工序库中存在多个同名工序“${normalized.name}”，请先合并重复工序`,
      'PROCESS_NAME_AMBIGUOUS',
    );
  }
  if (active[0]) {
    const definition = active[0].nameKey === normalized.nameKey || matches.length > 1
      ? active[0]
      : await tx.processDefinition.update({
          where: { id: active[0].id },
          data: { nameKey: normalized.nameKey },
        });
    return { definition, action: 'REUSED' as const };
  }
  if (matches[0]) {
    const definition = await tx.processDefinition.update({
      where: { id: matches[0].id },
      data: { isActive: true, nameKey: normalized.nameKey },
    });
    return { definition, action: 'REACTIVATED' as const };
  }
  const maxSort = input.sortOrder === undefined
    ? await tx.processDefinition.aggregate({ _max: { sortOrder: true } })
    : null;
  const definition = await tx.processDefinition.create({
    data: {
      code: input.code || `process-${randomUUID()}`,
      name: normalized.name,
      nameKey: normalized.nameKey,
      stageGroup: normalizedStageGroup(input.stageGroup),
      isActive: true,
      sortOrder: input.sortOrder ?? ((maxSort?._max.sortOrder || 0) + 1),
    },
  });
  return { definition, action: 'CREATED' as const };
}
