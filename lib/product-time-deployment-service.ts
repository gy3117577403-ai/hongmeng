import { createHash } from 'node:crypto';
import {
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessMovementType,
  ProcessRouteChangeStatus,
  ProcessRouteChangeStepSource,
  ProcessStepExecutionMode,
  ProcessSupplementObligationStatus,
  ProductTimeDeploymentRouteStatus,
  ProductTimeDeploymentStatus,
} from '@prisma/client';
import {
  calculateCompletionLaborSnapshot,
  planLaborClaim,
} from '@/lib/process-completion-domain';
import { calculateAttainmentBasisPoints } from '@/lib/process-time';
import {
  productTimeProfileInclude,
  productTimeStandardSnapshot,
  type ProductTimeProfileRecord,
} from '@/lib/product-time';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import {
  syncDailyTasksAfterProcessRouteChange,
} from '@/lib/process-route-change-daily-task-sync';
import { prisma } from '@/lib/prisma';

type Tx = Prisma.TransactionClient;

export type ProductTimeDeploymentDiffDTO = {
  kind: 'insert' | 'move' | 'update_time' | 'delete';
  occurrenceKey: string;
  processDefinitionId?: string | null;
  processName: string;
  previousProcessName?: string | null;
  oldSequence?: number | null;
  newSequence?: number | null;
  oldUnitMilliseconds?: number | null;
  newUnitMilliseconds?: number | null;
};

export type ProductTimeDeploymentConflictDTO = {
  code: string;
  message: string;
  workOrderId?: string | null;
  workOrderCode?: string | null;
};

export type ProductTimeDeploymentRouteDTO = {
  workOrderId: string;
  workOrderCode: string;
  state: 'unstarted' | 'in_progress' | 'completed';
  status: 'pending' | 'applying' | 'succeeded' | 'failed' | 'blocked' | 'unchanged';
  qrUpdated: boolean;
  routeVersionBefore?: number | null;
  routeVersionAfter?: number | null;
  insertedProcesses?: number;
  movedProcesses?: number;
  updatedTimes?: number;
  historicalReports?: number;
  affectedEmployees?: number;
  supplementObligations?: number;
  error?: string | null;
};

export type ProductTimeDeploymentImpactDTO = {
  workOrders: { total: number; unstarted: number; inProgress: number; completed: number };
  historicalReports: number;
  affectedEmployees: number;
  attainmentRecords: number;
  supplementObligations: number;
  qrTickets: number;
  conflicts: number;
};

export type ProductTimeDeploymentPreviewDTO = {
  previewToken: string;
  itemId: string;
  draftProfileId: string;
  fromVersion?: number | null;
  toVersion: number;
  status: 'preview';
  generatedAt: string;
  canPublish: boolean;
  diffs: ProductTimeDeploymentDiffDTO[];
  impact: ProductTimeDeploymentImpactDTO;
  conflicts: ProductTimeDeploymentConflictDTO[];
  routes: ProductTimeDeploymentRouteDTO[];
};

export type ProductTimeDeploymentDTO = {
  id: string;
  itemId: string;
  profileId?: string | null;
  profileVersion: number;
  status: 'pending' | 'applying' | 'active' | 'failed';
  createdAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  impact: ProductTimeDeploymentImpactDTO;
  diffs: ProductTimeDeploymentDiffDTO[];
  conflicts: ProductTimeDeploymentConflictDTO[];
  routes: ProductTimeDeploymentRouteDTO[];
};

export class ProductTimeDeploymentError extends Error {
  readonly status: number;
  readonly code: string;
  readonly deployment?: ProductTimeDeploymentDTO;

  constructor(
    message: string,
    status = 409,
    code = 'PRODUCT_TIME_DEPLOYMENT_FAILED',
    deployment?: ProductTimeDeploymentDTO,
  ) {
    super(message);
    this.name = 'ProductTimeDeploymentError';
    this.status = status;
    this.code = code;
    this.deployment = deployment;
  }
}

function isRetryableSerializableConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (
      error.code === 'P2034'
      || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code || '')))
    );
}

const routeInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  workOrder: {
    select: {
      id: true,
      code: true,
      status: true,
      stage: true,
      progress: true,
      completedAt: true,
      productionTargetQty: true,
      uncompletedQty: true,
      completedQty: true,
      qrTicket: { select: { id: true, publicCode: true, status: true } },
    },
  },
  steps: {
    where: { retiredAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: {
      productTimeEntry: { select: { occurrenceKey: true } },
      supplementObligation: {
        select: {
          id: true,
          changeId: true,
          diffId: true,
          occurrenceKey: true,
          status: true,
          requiredQty: true,
          reportedQty: true,
        },
      },
      completions: {
        where: { voidedAt: null },
        select: {
          id: true,
          principalEmployeeId: true,
          completedAt: true,
          laborPool: {
            select: {
              id: true,
              status: true,
              claims: {
                where: { status: ProcessLaborClaimStatus.ACTIVE },
                select: { employeeId: true },
              },
            },
          },
        },
      },
      executions: {
        where: { voidedAt: null },
        select: { id: true, employeeId: true },
      },
      _count: {
        select: {
          dailyProcessTasks: true,
          processLaborPools: true,
          sourceQuantityMovements: true,
          targetQuantityMovements: true,
        },
      },
    },
  },
  processRouteChanges: {
    where: {
      status: {
        in: [
          ProcessRouteChangeStatus.SUBMITTED,
          ProcessRouteChangeStatus.APPROVED,
          ProcessRouteChangeStatus.ACTIVATING,
        ],
      },
    },
    select: { id: true, status: true },
  },
});

type DeploymentRouteRecord = Prisma.WorkOrderProcessRouteGetPayload<{ include: typeof routeInclude }>;
type DeploymentStepRecord = DeploymentRouteRecord['steps'][number];

const deploymentInclude = Prisma.validator<Prisma.ProductTimeDeploymentInclude>()({
  routes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      workOrder: { select: { code: true, qrTicket: { select: { id: true } } } },
    },
  },
});

type DeploymentRecord = Prisma.ProductTimeDeploymentGetPayload<{ include: typeof deploymentInclude }>;

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stable(item)]));
}

function previewToken(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function stepOccurrenceKey(step: DeploymentStepRecord): string | null {
  if (step.productTimeEntry?.occurrenceKey) return step.productTimeEntry.occurrenceKey;
  if (step.supplementObligation?.occurrenceKey) return step.supplementObligation.occurrenceKey;
  if (step.supplementObligation?.changeId && step.supplementObligation.diffId) {
    return `route-change:${step.supplementObligation.changeId}:${step.supplementObligation.diffId}`;
  }
  return null;
}

function stepHasFacts(step: DeploymentStepRecord): boolean {
  return step.completions.length > 0
    || step.executions.length > 0
    || step.processedQty > 0
    || step.goodOutputQty > 0
    || step.defectOutputQty > 0
    || step.releasedGoodQty > 0
    || step._count.processLaborPools > 0
    || step._count.sourceQuantityMovements > 0
    || step._count.targetQuantityMovements > 0;
}

function routeHasFacts(route: DeploymentRouteRecord): boolean {
  return route.steps.some(stepHasFacts)
    || route.status === 'completed'
    || Boolean(route.completedAt)
    || Boolean(route.workOrder.completedAt);
}

function routeState(route: DeploymentRouteRecord): ProductTimeDeploymentRouteDTO['state'] {
  if (route.status === 'completed' || route.completedAt || route.workOrder.completedAt) return 'completed';
  if (!routeHasFacts(route) && !route.startedAt) return 'unstarted';
  return 'in_progress';
}

function entryStandard(entry: ProductTimeProfileRecord['entries'][number]) {
  const actionBased = entry.timeBasis !== 'per_batch'
    && Boolean(entry.actionMilliseconds)
    && entry.occurrences > 1;
  return {
    timeBasis: entry.timeBasis === 'per_batch' ? 'per_batch' as const : 'per_unit' as const,
    standardMillisecondsPerUnit: actionBased ? entry.actionMilliseconds as number : entry.unitMilliseconds,
    setupMilliseconds: entry.setupMilliseconds,
    unitsPerProduct: actionBased ? entry.occurrences : 1,
    unitLabel: entry.unitLabel,
    countsForEfficiency: entry.countsForEfficiency,
  };
}

function sameStandard(
  left: ProductTimeProfileRecord['entries'][number],
  right: ProductTimeProfileRecord['entries'][number],
): boolean {
  const first = entryStandard(left);
  const second = entryStandard(right);
  return first.timeBasis === second.timeBasis
    && first.standardMillisecondsPerUnit === second.standardMillisecondsPerUnit
    && first.setupMilliseconds === second.setupMilliseconds
    && first.unitsPerProduct === second.unitsPerProduct
    && first.unitLabel === second.unitLabel
    && first.countsForEfficiency === second.countsForEfficiency;
}

function stepStandardMatchesEntry(
  step: DeploymentStepRecord,
  entry: ProductTimeProfileRecord['entries'][number],
): boolean {
  const standard = entryStandard(entry);
  return step.timeBasis === standard.timeBasis
    && step.standardMillisecondsPerUnit === standard.standardMillisecondsPerUnit
    && step.setupMilliseconds === standard.setupMilliseconds
    && step.unitsPerProduct === standard.unitsPerProduct
    && step.unitLabel === standard.unitLabel
    && step.countsForEfficiency === standard.countsForEfficiency;
}

function routeDeploymentDrift(
  route: DeploymentRouteRecord,
  profile: ProductTimeProfileRecord,
) {
  const currentByKey = new Map<string, DeploymentStepRecord>();
  for (const step of route.steps) {
    const key = stepOccurrenceKey(step);
    if (key) currentByKey.set(key, step);
  }
  const desiredByKey = new Map(profile.entries.map(entry => [entry.occurrenceKey, entry] as const));
  const createdEntries = profile.entries.filter(entry => {
    const current = currentByKey.get(entry.occurrenceKey);
    return !current || current.processDefinitionId !== entry.processDefinitionId;
  });
  const timeChangedEntries = profile.entries.filter(entry => {
    const current = currentByKey.get(entry.occurrenceKey);
    return Boolean(
      current
      && current.processDefinitionId === entry.processDefinitionId
      && !stepStandardMatchesEntry(current, entry),
    );
  });
  const removedSteps = route.steps.filter(step => {
    const key = stepOccurrenceKey(step);
    const desired = key ? desiredByKey.get(key) : null;
    return !desired || desired.processDefinitionId !== step.processDefinitionId;
  });
  const actualCommon = route.steps
    .map(step => ({ step, key: stepOccurrenceKey(step) }))
    .filter((item): item is { step: DeploymentStepRecord; key: string } => {
      if (!item.key) return false;
      return desiredByKey.get(item.key)?.processDefinitionId === item.step.processDefinitionId;
    });
  const desiredCommon = profile.entries.filter(entry => (
    currentByKey.get(entry.occurrenceKey)?.processDefinitionId === entry.processDefinitionId
  ));
  const movedKeys = new Set<string>();
  const actualKeys = actualCommon.map(item => item.key);
  const desiredKeys = desiredCommon.map(entry => entry.occurrenceKey);
  if (actualKeys.some((key, index) => desiredKeys[index] !== key)) {
    for (const [index, key] of desiredKeys.entries()) {
      if (actualKeys[index] !== key) movedKeys.add(key);
    }
  } else {
    // Absolute group numbers naturally shift when a missing operation is
    // inserted. Compare the parallel/sequential relationship between retained
    // neighbours so that insertion shifts are not mislabeled as MOVE.
    for (let index = 1; index < desiredCommon.length; index += 1) {
      const desiredParallel = desiredCommon[index - 1].sequenceGroup === desiredCommon[index].sequenceGroup;
      const actualParallel = actualCommon[index - 1].step.sequenceGroup === actualCommon[index].step.sequenceGroup;
      if (desiredParallel !== actualParallel) {
        movedKeys.add(desiredCommon[index - 1].occurrenceKey);
        movedKeys.add(desiredCommon[index].occurrenceKey);
      }
    }
  }
  return {
    currentByKey,
    createdEntries,
    timeChangedEntries,
    removedSteps,
    movedKeys,
  };
}

function buildDiffs(
  previous: ProductTimeProfileRecord | null,
  next: ProductTimeProfileRecord,
): ProductTimeDeploymentDiffDTO[] {
  const beforeByKey = new Map((previous?.entries || []).map(entry => [entry.occurrenceKey, entry] as const));
  const afterByKey = new Map(next.entries.map(entry => [entry.occurrenceKey, entry] as const));
  const commonBefore = (previous?.entries || [])
    .filter(entry => afterByKey.get(entry.occurrenceKey)?.processDefinitionId === entry.processDefinitionId)
    .map(entry => entry.occurrenceKey);
  const commonAfter = next.entries
    .filter(entry => beforeByKey.get(entry.occurrenceKey)?.processDefinitionId === entry.processDefinitionId)
    .map(entry => entry.occurrenceKey);
  const movedKeys = new Set<string>();
  if (commonBefore.some((key, index) => commonAfter[index] !== key)) {
    for (const [index, key] of commonAfter.entries()) {
      if (commonBefore[index] !== key) movedKeys.add(key);
    }
  }
  const diffs: ProductTimeDeploymentDiffDTO[] = [];
  for (const entry of next.entries) {
    const before = beforeByKey.get(entry.occurrenceKey);
    if (!before || before.processDefinitionId !== entry.processDefinitionId) {
      diffs.push({
        kind: 'insert',
        occurrenceKey: entry.occurrenceKey,
        processDefinitionId: entry.processDefinitionId,
        processName: entry.processDefinition.name,
        previousProcessName: before?.processDefinition.name || null,
        oldSequence: before?.position ?? null,
        newSequence: entry.position,
        oldUnitMilliseconds: before ? entryStandard(before).standardMillisecondsPerUnit : null,
        newUnitMilliseconds: entryStandard(entry).standardMillisecondsPerUnit,
      });
      if (before) {
        diffs.push({
          kind: 'delete',
          occurrenceKey: before.occurrenceKey,
          processDefinitionId: before.processDefinitionId,
          processName: before.processDefinition.name,
          oldSequence: before.position,
          newSequence: null,
          oldUnitMilliseconds: entryStandard(before).standardMillisecondsPerUnit,
          newUnitMilliseconds: null,
        });
      }
      continue;
    }
    if (movedKeys.has(entry.occurrenceKey)) {
      diffs.push({
        kind: 'move',
        occurrenceKey: entry.occurrenceKey,
        processDefinitionId: entry.processDefinitionId,
        processName: entry.processDefinition.name,
        oldSequence: before.position,
        newSequence: entry.position,
      });
    }
    if (!sameStandard(before, entry)) {
      diffs.push({
        kind: 'update_time',
        occurrenceKey: entry.occurrenceKey,
        processDefinitionId: entry.processDefinitionId,
        processName: entry.processDefinition.name,
        oldSequence: before.position,
        newSequence: entry.position,
        oldUnitMilliseconds: entryStandard(before).standardMillisecondsPerUnit,
        newUnitMilliseconds: entryStandard(entry).standardMillisecondsPerUnit,
      });
    }
  }
  for (const entry of previous?.entries || []) {
    if (afterByKey.has(entry.occurrenceKey)) continue;
    diffs.push({
      kind: 'delete',
      occurrenceKey: entry.occurrenceKey,
      processDefinitionId: entry.processDefinitionId,
      processName: entry.processDefinition.name,
      oldSequence: entry.position,
      newSequence: null,
      oldUnitMilliseconds: entryStandard(entry).standardMillisecondsPerUnit,
      newUnitMilliseconds: null,
    });
  }
  return diffs;
}

function downstreamHasFacts(
  route: DeploymentRouteRecord,
  entry: ProductTimeProfileRecord['entries'][number],
  oldEntries: ProductTimeProfileRecord['entries'],
): boolean {
  if (routeState(route) === 'completed') return true;
  const oldPositionByKey = new Map(oldEntries.map(item => [item.occurrenceKey, item.position] as const));
  return route.steps.some(step => {
    if (!stepHasFacts(step)) return false;
    const key = stepOccurrenceKey(step);
    const desiredPosition = key
      ? oldPositionByKey.get(key)
      : null;
    return desiredPosition == null || desiredPosition >= entry.position;
  });
}

async function loadPreviewContext(
  tx: Tx,
  itemId: string,
  profileStatus: 'draft' | 'published' = 'draft',
) {
  const profile = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: itemId, status: profileStatus },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    include: productTimeProfileInclude,
  });
  if (!profile) {
    throw new ProductTimeDeploymentError(
      profileStatus === 'draft' ? '没有可发布的产品工序与工时草稿' : '没有已发布的产品工序与工时版本',
      404,
      profileStatus === 'draft' ? 'DRAFT_NOT_FOUND' : 'PUBLISHED_PROFILE_NOT_FOUND',
    );
  }
  if (!profile.entries.length) {
    throw new ProductTimeDeploymentError('至少配置一道工序后才能发布', 400, 'PRODUCT_TIME_EMPTY');
  }
  const previous = await tx.productTimeProfile.findFirst({
    where: {
      drawingLibraryItemId: itemId,
      status: profileStatus === 'draft' ? 'published' : 'archived',
      ...(profileStatus === 'published' ? { version: { lt: profile.version } } : {}),
    },
    orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
    include: productTimeProfileInclude,
  });
  const routes = await tx.workOrderProcessRoute.findMany({
    where: {
      workOrder: {
        drawingLibraryItemId: itemId,
        deletedAt: null,
        branchType: null,
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: routeInclude,
  });
  return { profile, previous, routes };
}

function previewFromContext(
  itemId: string,
  context: Awaited<ReturnType<typeof loadPreviewContext>>,
): ProductTimeDeploymentPreviewDTO {
  const { profile, previous, routes } = context;
  const diffs = buildDiffs(previous, profile);
  const conflicts: ProductTimeDeploymentConflictDTO[] = [];
  const nextByKey = new Map(profile.entries.map(entry => [entry.occurrenceKey, entry] as const));
  const oldEntries = previous?.entries || [];
  let supplementObligations = 0;
  let historicalReports = 0;
  let attainmentRecords = 0;
  const employees = new Set<string>();

  const routeDtos = routes.map(route => {
    const state = routeState(route);
    const routeFacts = routeHasFacts(route);
    const drift = routeDeploymentDrift(route, profile);
    const timeChangedKeys = new Set(drift.timeChangedEntries.map(entry => entry.occurrenceKey));
    let routeReports = 0;
    const routeEmployees = new Set<string>();
    if (route.processRouteChanges.length) {
      conflicts.push({
        code: 'PENDING_ROUTE_CHANGE',
        message: '该工单存在待审核或正在启用的现场工艺变更，请先完成后再发布产品版本',
        workOrderId: route.workOrderId,
        workOrderCode: route.workOrder.code,
      });
    }
    if (routeFacts) {
      for (const occurrenceKey of drift.movedKeys) {
        const movedStep = drift.currentByKey.get(occurrenceKey);
        const desired = nextByKey.get(occurrenceKey);
        if (!movedStep || !desired) continue;
        const lower = Math.min(movedStep.position, desired.position);
        const upper = Math.max(movedStep.position, desired.position);
        const crossesQuantityFacts = route.steps.some(step => {
          return step.position >= lower
            && step.position <= upper
            && (
              stepHasFacts(step)
              || step.inputQty > 0
              || step._count.sourceQuantityMovements > 0
              || step._count.targetQuantityMovements > 0
            );
        });
        if (crossesQuantityFacts) {
          conflicts.push({
            code: 'MOVE_CROSSES_QUANTITY_FACTS',
            message: `${desired.processDefinition.name} 的调序跨越了已有投入、报工或数量台账；直接改顺序会破坏转序闭环，请另建后续版本或先完成当前工单`,
            workOrderId: route.workOrderId,
            workOrderCode: route.workOrder.code,
          });
        }
      }
    }
    for (const removed of drift.removedSteps) {
      if (
        removed
        && removed.executionMode === ProcessStepExecutionMode.NORMAL
        && removed.status !== 'completed'
        && removed.status !== 'skipped'
        && (
          removed.inputQty > 0
          || removed.processedQty > 0
          || removed.goodOutputQty > 0
          || removed.defectOutputQty > 0
          || removed.releasedGoodQty > 0
          || removed._count.sourceQuantityMovements > 0
          || removed._count.targetQuantityMovements > 0
        )
      ) {
        conflicts.push({
          code: 'DELETE_ACTIVE_QUANTITY_FACTS',
          message: `${removed.processName} 仍有在途投入或数量台账，直接删除会丢失转序数量；只能在该工序完成后退役，或另行做数量调整`,
          workOrderId: route.workOrderId,
          workOrderCode: route.workOrder.code,
        });
      }
    }
    const keys = new Set<string>();
    for (const step of route.steps) {
      const key = stepOccurrenceKey(step);
      if (key && keys.has(key)) {
        conflicts.push({
          code: 'DUPLICATE_ROUTE_OCCURRENCE',
          message: `${step.processName} 的工序实例标识重复，不能安全同步`,
          workOrderId: route.workOrderId,
          workOrderCode: route.workOrder.code,
        });
      }
      if (key) keys.add(key);
      if (routeFacts && step.executionMode === ProcessStepExecutionMode.NORMAL && !key) {
        conflicts.push({
          code: 'ROUTE_OCCURRENCE_IDENTITY_MISSING',
          message: `${step.processName} 缺少稳定工序实例标识；有历史报工时禁止按名称或位置猜测`,
          workOrderId: route.workOrderId,
          workOrderCode: route.workOrder.code,
        });
      }
      if (key && timeChangedKeys.has(key)) {
        historicalReports += step.completions.length;
        routeReports += step.completions.length;
        attainmentRecords += step.executions.length;
        for (const execution of step.executions) {
          employees.add(execution.employeeId);
          routeEmployees.add(execution.employeeId);
        }
        for (const completion of step.completions) {
          if (completion.principalEmployeeId) {
            employees.add(completion.principalEmployeeId);
            routeEmployees.add(completion.principalEmployeeId);
          }
          for (const claim of completion.laborPool?.claims || []) {
            employees.add(claim.employeeId);
            routeEmployees.add(claim.employeeId);
          }
        }
      }
    }
    const routeSupplements = drift.createdEntries.filter(entry => (
      routeFacts && (downstreamHasFacts(route, entry, oldEntries) || !route.steps.some(step => {
        const key = stepOccurrenceKey(step);
        const desired = key ? nextByKey.get(key) : null;
        return desired && desired.position > entry.position;
      }))
    )).length;
    supplementObligations += routeSupplements;
    return {
      workOrderId: route.workOrderId,
      workOrderCode: route.workOrder.code,
      state,
      status: conflicts.some(item => item.workOrderId === route.workOrderId) ? 'blocked' as const : 'pending' as const,
      qrUpdated: false,
      routeVersionBefore: route.version,
      routeVersionAfter: null,
      insertedProcesses: drift.createdEntries.length,
      movedProcesses: drift.movedKeys.size,
      updatedTimes: drift.timeChangedEntries.length,
      historicalReports: routeReports,
      affectedEmployees: routeEmployees.size,
      supplementObligations: routeSupplements,
      error: null,
    };
  });

  const stateCounts = { unstarted: 0, in_progress: 0, completed: 0 };
  for (const route of routeDtos) stateCounts[route.state] += 1;
  const impact: ProductTimeDeploymentImpactDTO = {
    workOrders: {
      total: routeDtos.length,
      unstarted: stateCounts.unstarted,
      inProgress: stateCounts.in_progress,
      completed: stateCounts.completed,
    },
    historicalReports,
    affectedEmployees: employees.size,
    attainmentRecords,
    supplementObligations,
    qrTickets: routes.filter(route => route.workOrder.qrTicket?.status === 'ACTIVE').length,
    conflicts: conflicts.length,
  };
  const token = previewToken({
    itemId,
    profileId: profile.id,
    profileRevision: profile.revision,
    profileVersion: profile.version,
    previousProfileId: previous?.id || null,
    diffs,
    routes: routes.map(route => ({ id: route.id, version: route.version })),
    conflicts,
  });
  return {
    previewToken: token,
    itemId,
    draftProfileId: profile.id,
    fromVersion: previous?.version || null,
    toVersion: profile.version,
    status: 'preview',
    generatedAt: new Date().toISOString(),
    canPublish: conflicts.length === 0,
    diffs,
    impact,
    conflicts,
    routes: routeDtos,
  };
}

export async function previewProductTimeDeployment(
  itemId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<ProductTimeDeploymentPreviewDTO> {
  return previewFromContext(itemId, await loadPreviewContext(tx as Tx, itemId, 'draft'));
}

type CorrectionSummary = {
  completions: number;
  executions: number;
  pools: number;
  claims: number;
  employeeIds: string[];
};

async function correctHistoricalStandard(
  tx: Tx,
  input: {
    deploymentId: string;
    stepId: string;
    profile: ProductTimeProfileRecord;
    entry: ProductTimeProfileRecord['entries'][number];
    actorId: string;
  },
): Promise<CorrectionSummary> {
  const standard = entryStandard(input.entry);
  const completions = await tx.processCompletion.findMany({
    where: { stepId: input.stepId, voidedAt: null },
    include: {
      laborPool: {
        include: {
          claims: {
            where: { status: ProcessLaborClaimStatus.ACTIVE, quantity: { gt: 0 } },
            orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
  });
  const executions = await tx.processExecution.findMany({
    where: { stepId: input.stepId, voidedAt: null },
    orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
  });
  const employees = new Set(executions.map(execution => execution.employeeId));
  const eligiblePools = completions.filter(item => (
    item.laborPool && item.laborPool.status !== ProcessLaborPoolStatus.VOIDED
  ));
  const setupPoolId = standard.timeBasis === 'per_batch'
    ? eligiblePools.at(-1)?.laborPool?.id || null
    : eligiblePools[0]?.laborPool?.id || null;
  // Pools/ACTIVE claims are the authoritative modern attainment ledger. Only
  // when no pool exists may a legacy ProcessExecution carry setup time. A raw
  // completion snapshot is the final fallback. This keeps setup once across a
  // mixed legacy + modern history instead of once per table.
  const setupExecutionId = eligiblePools.length === 0
    ? standard.timeBasis === 'per_batch'
      ? executions.at(-1)?.id || null
      : executions[0]?.id || null
    : null;
  const setupCompletionId = eligiblePools.length > 0
    ? standard.timeBasis === 'per_batch'
      ? eligiblePools.at(-1)?.id || null
      : eligiblePools[0]?.id || null
    : executions.length === 0
      ? standard.timeBasis === 'per_batch'
        ? completions.at(-1)?.id || null
        : completions[0]?.id || null
      : null;
  const now = new Date();
  let pools = 0;
  let claims = 0;

  for (const completion of completions) {
    const completionSetup = completion.id === setupCompletionId ? standard.setupMilliseconds : 0;
    await tx.processCompletion.update({
      where: { id: completion.id },
      data: {
        standardTimeId: null,
        standardVersion: null,
        productTimeProfileId: input.profile.id,
        productTimeEntryId: input.entry.id,
        productTimeProfileVersion: input.profile.version,
        standardSource: 'product_time_deployment',
        timeBasis: standard.timeBasis,
        unitLabel: standard.unitLabel,
        standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
        setupMilliseconds: completionSetup,
        unitsPerProduct: standard.unitsPerProduct,
        countsForEfficiency: standard.countsForEfficiency,
      },
    });
    const pool = completion.laborPool;
    if (!pool || pool.status === ProcessLaborPoolStatus.VOIDED) continue;
    const effectiveSetup = pool.id === setupPoolId ? standard.setupMilliseconds : 0;
    const snapshot = calculateCompletionLaborSnapshot({
      timeBasis: standard.timeBasis,
      eligibleQty: pool.eligibleQty,
      standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
      setupMilliseconds: effectiveSetup,
      unitsPerProduct: standard.unitsPerProduct,
    });
    let claimedQty = 0;
    let claimedLabor = 0n;
    for (const claim of pool.claims) {
      const plan = planLaborClaim({
        eligibleQty: pool.eligibleQty,
        claimedQty,
        claimQty: claim.quantity,
        totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
        claimedStandardLaborMilliseconds: claimedLabor,
      });
      claimedQty = plan.nextClaimedQty;
      claimedLabor = plan.nextClaimedStandardLaborMilliseconds;
      employees.add(claim.employeeId);
      const key = `product-time-deployment:${input.deploymentId}:${claim.id}`;
      await tx.processLaborClaim.update({
        where: { id: claim.id },
        data: {
          status: ProcessLaborClaimStatus.VOIDED,
          voidedAt: now,
          voidedById: input.actorId,
          voidReason: `产品工序与工时 V${input.profile.version} 发布后追溯调整`,
        },
      });
      await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: claim.employeeId,
          quantity: -claim.quantity,
          standardLaborMilliseconds: -claim.standardLaborMilliseconds,
          workDate: claim.workDate,
          status: ProcessLaborClaimStatus.REVERSAL,
          source: 'product_time_deployment',
          idempotencyKey: `${key}:reverse`.slice(0, 120),
          claimedById: input.actorId,
          claimedAt: now,
          reversalOfId: claim.id,
        },
      });
      await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: claim.employeeId,
          quantity: claim.quantity,
          standardLaborMilliseconds: plan.claimStandardLaborMilliseconds,
          workDate: claim.workDate,
          status: ProcessLaborClaimStatus.ACTIVE,
          source: 'product_time_deployment',
          idempotencyKey: `${key}:replacement`.slice(0, 120),
          claimedById: input.actorId,
          claimedAt: now,
        },
      });
      claims += 1;
    }
    const status = claimedQty <= 0
      ? ProcessLaborPoolStatus.OPEN
      : claimedQty >= pool.eligibleQty
        ? ProcessLaborPoolStatus.EXHAUSTED
        : ProcessLaborPoolStatus.PARTIAL;
    await tx.processLaborPool.update({
      where: { id: pool.id },
      data: {
        claimedQty,
        remainingQty: pool.eligibleQty - claimedQty,
        status,
        standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
        setupMilliseconds: effectiveSetup,
        unitsPerProduct: standard.unitsPerProduct,
        totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
        claimedStandardLaborMilliseconds: claimedLabor,
        remainingStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds - claimedLabor,
        countsForEfficiency: standard.countsForEfficiency,
        standardSource: 'product_time_deployment',
        productTimeProfileVersion: input.profile.version,
        version: { increment: 1 },
      },
    });
    pools += 1;
  }
  for (const execution of executions) {
    const executionSetup = execution.id === setupExecutionId ? standard.setupMilliseconds : 0;
    const variable = standard.timeBasis === 'per_batch'
      ? standard.standardMillisecondsPerUnit
      : standard.standardMillisecondsPerUnit * execution.goodQty * standard.unitsPerProduct;
    const standardLaborMilliseconds = executionSetup + variable;
    if (!Number.isSafeInteger(standardLaborMilliseconds) || standardLaborMilliseconds <= 0) {
      throw new ProductTimeDeploymentError(
        '历史报工重算标准工时超出安全范围',
        409,
        'PRODUCT_TIME_HISTORICAL_RECALCULATION_INVALID',
      );
    }
    await tx.processExecution.update({
      where: { id: execution.id },
      data: {
        timeBasis: standard.timeBasis,
        unitLabel: standard.unitLabel,
        standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
        setupMilliseconds: executionSetup,
        unitsPerProduct: standard.unitsPerProduct,
        standardLaborMilliseconds,
        attainmentBasisPoints: calculateAttainmentBasisPoints(
          standardLaborMilliseconds,
          execution.actualLaborMilliseconds,
        ),
        countsForEfficiency: standard.countsForEfficiency,
        standardSource: 'product_time_deployment',
        productTimeProfileVersion: input.profile.version,
      },
    });
  }
  const obligation = await tx.processSupplementObligation.findUnique({
    where: { displayStepId: input.stepId },
    select: { id: true, version: true, status: true },
  });
  if (obligation?.status === ProcessSupplementObligationStatus.ACTIVE) {
    const updated = await tx.processSupplementObligation.updateMany({
      where: {
        id: obligation.id,
        version: obligation.version,
        status: ProcessSupplementObligationStatus.ACTIVE,
      },
      data: {
        timeBasis: standard.timeBasis,
        unitLabel: standard.unitLabel,
        standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
        setupMilliseconds: standard.setupMilliseconds,
        unitsPerProduct: standard.unitsPerProduct,
        countsForEfficiency: standard.countsForEfficiency,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProductTimeDeploymentError(
        '补充工序义务版本已变化，请刷新后重试',
        409,
        'PRODUCT_TIME_SUPPLEMENT_VERSION_CONFLICT',
      );
    }
  }
  return {
    completions: completions.length,
    executions: executions.length,
    pools,
    claims,
    employeeIds: [...employees],
  };
}

async function retireRemovedStep(tx: Tx, step: DeploymentStepRecord, deploymentRouteId: string) {
  const now = new Date();
  let cancelledSupplement = false;
  if (
    step.supplementObligation
    && step.supplementObligation.status === ProcessSupplementObligationStatus.ACTIVE
  ) {
    await tx.processSupplementObligation.update({
      where: { id: step.supplementObligation.id },
      data: {
        status: ProcessSupplementObligationStatus.CANCELLED,
        version: { increment: 1 },
      },
    });
    cancelledSupplement = true;
  }
  await tx.dailyTaskAssignment.updateMany({
    where: {
      task: { stepId: step.id },
      status: { in: ['PLANNED', 'ACTIVE'] },
    },
    data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
  });
  await tx.dailyProcessTask.updateMany({
    where: {
      stepId: step.id,
      status: { notIn: ['COMPLETED', 'CARRIED_OVER', 'CANCELLED'] },
    },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });
  const hasReferences = stepHasFacts(step)
    || step._count.dailyProcessTasks > 0
    || Boolean(step.supplementObligation);
  if (!hasReferences) {
    await tx.workOrderProcessStep.delete({ where: { id: step.id } });
    return { cancelledSupplement };
  }
  await tx.workOrderProcessStep.update({
    where: { id: step.id },
    data: {
      retiredAt: now,
      productTimeDeploymentRouteId: deploymentRouteId,
      status: step.status === 'completed' ? 'completed' : 'skipped',
      remark: [step.remark, '产品工序与工时发布后退役；历史报工保留'].filter(Boolean).join('；'),
    },
  });
  return { cancelledSupplement };
}

async function redirectSequentialInput(
  tx: Tx,
  input: {
    deploymentId: string;
    workOrderId: string;
    route: DeploymentRouteRecord;
    targetSteps: DeploymentStepRecord[];
    insertedStepIds: string[];
    insertedSequenceGroup: number;
  },
) {
  if (!input.targetSteps.length || !input.insertedStepIds.length) return 0;
  const quantities = [...new Set(input.targetSteps.map(step => step.inputQty))];
  if (quantities.length !== 1) {
    throw new ProductTimeDeploymentError(
      '目标并行工序组投入数量不一致，不能安全插入新工序',
      409,
      'PRODUCT_TIME_INSERT_INPUT_CONFLICT',
    );
  }
  const transferred = quantities[0] || 0;
  if (transferred <= 0) return 0;
  const targetIds = input.targetSteps.map(step => step.id);
  const incoming = await tx.processQuantityMovement.findMany({
    where: {
      workOrderId: input.workOrderId,
      targetStepId: { in: targetIds },
      type: ProcessMovementType.GOOD_TRANSFER,
      voidedAt: null,
    },
    include: {
      reversals: { where: { voidedAt: null }, select: { quantity: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const effective = incoming.map(movement => ({
    movement,
    quantity: movement.quantity - movement.reversals.reduce((sum, reversal) => sum + reversal.quantity, 0),
  })).filter(item => item.quantity > 0);
  const priorGroupExists = input.route.steps.some(step => (
    step.executionMode === ProcessStepExecutionMode.NORMAL
    && step.sequenceGroup < input.targetSteps[0].sequenceGroup
  ));
  if (priorGroupExists && effective.length === 0) {
    throw new ProductTimeDeploymentError(
      '目标工序已有投入但缺少有效数量流转台账，不能静默改接',
      409,
      'PRODUCT_TIME_INSERT_LEDGER_CONFLICT',
    );
  }
  if (effective.length > 0) {
    for (const target of input.targetSteps) {
      const ledgerInput = effective
        .filter(item => item.movement.targetStepId === target.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (ledgerInput !== transferred) {
        throw new ProductTimeDeploymentError(
          `${target.processName} 的有效入站台账 ${ledgerInput} 与投入数量 ${transferred} 不一致，不能安全改接`,
          409,
          'PRODUCT_TIME_INSERT_LEDGER_CONFLICT',
        );
      }
    }
  }
  const events = new Map<string, typeof effective>();
  for (const item of effective) {
    const key = [
      item.movement.completionId,
      item.movement.sourceStepId,
      item.movement.branchWorkOrderId || '',
      item.movement.sourceSequenceGroup,
    ].join(':');
    const group = events.get(key) || [];
    group.push(item);
    events.set(key, group);
  }
  let eventIndex = 0;
  for (const items of events.values()) {
    const perTarget = targetIds.map(targetId => items
      .filter(item => item.movement.targetStepId === targetId)
      .reduce((sum, item) => sum + item.quantity, 0));
    if (!perTarget[0] || perTarget.some(quantity => quantity !== perTarget[0])) {
      throw new ProductTimeDeploymentError(
        '目标并行工序组的入站台账不对称，不能安全改接',
        409,
        'PRODUCT_TIME_INSERT_LEDGER_CONFLICT',
      );
    }
    for (const item of items) {
      await tx.processQuantityMovement.create({
        data: {
          completionId: item.movement.completionId,
          workOrderId: item.movement.workOrderId,
          sourceStepId: item.movement.sourceStepId,
          targetStepId: item.movement.targetStepId,
          branchWorkOrderId: item.movement.branchWorkOrderId,
          type: ProcessMovementType.REVERSAL,
          quantity: item.quantity,
          sourceSequenceGroup: item.movement.sourceSequenceGroup,
          targetSequenceGroup: item.movement.targetSequenceGroup,
          reversalOfId: item.movement.id,
          idempotencyKey: `product-time:${input.deploymentId}:rewire-reversal:${item.movement.id}`.slice(0, 190),
        },
      });
    }
    const source = items[0].movement;
    for (const insertedStepId of input.insertedStepIds) {
      await tx.processQuantityMovement.create({
        data: {
          completionId: source.completionId,
          workOrderId: source.workOrderId,
          sourceStepId: source.sourceStepId,
          targetStepId: insertedStepId,
          branchWorkOrderId: source.branchWorkOrderId,
          type: ProcessMovementType.GOOD_TRANSFER,
          quantity: perTarget[0],
          sourceSequenceGroup: source.sourceSequenceGroup,
          targetSequenceGroup: input.insertedSequenceGroup,
          idempotencyKey: `product-time:${input.deploymentId}:rewire-good:${eventIndex}:${insertedStepId}`.slice(0, 190),
        },
      });
    }
    eventIndex += 1;
  }
  for (const target of input.targetSteps) {
    const updated = await tx.workOrderProcessStep.updateMany({
      where: {
        id: target.id,
        quantityVersion: target.quantityVersion,
        processedQty: 0,
        goodOutputQty: 0,
        defectOutputQty: 0,
        releasedGoodQty: 0,
      },
      data: {
        inputQty: 0,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        completedById: null,
        quantityVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProductTimeDeploymentError(
        '目标工序数量已变化，请刷新后重试发布',
        409,
        'PRODUCT_TIME_STEP_QUANTITY_CONFLICT',
      );
    }
  }
  return transferred;
}

async function applyRouteDeployment(
  tx: Tx,
  input: {
    deploymentId: string;
    deploymentRouteId: string;
    actorId: string;
    profile: ProductTimeProfileRecord;
    previous: ProductTimeProfileRecord | null;
    route: DeploymentRouteRecord;
    diffs: ProductTimeDeploymentDiffDTO[];
  },
) {
  const { route, profile, previous } = input;
  const routeLock = await tx.workOrderProcessRoute.updateMany({
    where: { id: route.id, version: route.version },
    data: {
      templateId: null,
      templateName: `${route.workOrder.code} 产品工序与工时`,
      templateVersion: profile.version,
      productTimeProfileId: profile.id,
      productTimeProfileVersion: profile.version,
      routeSource: 'product_time_profile',
      version: { increment: 1 },
    },
  });
  if (routeLock.count !== 1) {
    throw new ProductTimeDeploymentError(
      `工单 ${route.workOrder.code} 的路线版本已变化`,
      409,
      'PRODUCT_TIME_ROUTE_VERSION_CONFLICT',
    );
  }

  const facts = routeHasFacts(route);
  const currentByKey = new Map<string, DeploymentStepRecord>();
  for (const step of route.steps) {
    const key = stepOccurrenceKey(step);
    if (key) currentByKey.set(key, step);
  }
  const routeDrift = routeDeploymentDrift(route, profile);
  const insertedEntries = routeDrift.createdEntries;
  const retainedIds = new Set<string>();
  const stepIdByKey = new Map<string, string>();
  const insertedSteps: Array<{ stepId: string; insertBeforeStepId?: string | null }> = [];
  const timeChangedStepIds: string[] = [];
  const stepChanges: Array<{
    stepId: string;
    kind: ProductTimeDeploymentDiffDTO['kind'];
    previousStandardMillisecondsPerUnit: number | null;
  }> = [];
  let correctedReports = 0;
  const affectedEmployeeIds = new Set<string>();
  let supplements = 0;
  let reopened = false;
  let cancelledSupplement = false;

  // Move every live step away from its final positions first. Retired history is
  // deliberately excluded and already lives outside the reporting projection.
  const allPositions = await tx.workOrderProcessStep.findMany({
    where: { routeId: route.id },
    select: { position: true },
  });
  const temporaryPositionBase = Math.max(0, ...allPositions.map(step => step.position)) + 100_000;
  for (const [index, step] of route.steps.entries()) {
    await tx.workOrderProcessStep.update({
      where: { id: step.id },
      data: { position: temporaryPositionBase + index },
    });
  }

  for (const entry of profile.entries) {
    const existing = currentByKey.get(entry.occurrenceKey);
    if (existing && existing.processDefinitionId === entry.processDefinitionId) {
      retainedIds.add(existing.id);
      stepIdByKey.set(entry.occurrenceKey, existing.id);
      const changedTime = !stepStandardMatchesEntry(existing, entry);
      if (changedTime) {
        const correction = await correctHistoricalStandard(tx, {
          deploymentId: input.deploymentId,
          stepId: existing.id,
          profile,
          entry,
          actorId: input.actorId,
        });
        correctedReports += correction.completions;
        for (const employeeId of correction.employeeIds) affectedEmployeeIds.add(employeeId);
        timeChangedStepIds.push(existing.id);
        stepChanges.push({
          stepId: existing.id,
          kind: 'update_time',
          previousStandardMillisecondsPerUnit: existing.standardMillisecondsPerUnit,
        });
      }
      await tx.workOrderProcessStep.update({
        where: { id: existing.id },
        data: {
          processDefinitionId: entry.processDefinitionId,
          processCode: entry.processDefinition.code,
          processName: entry.processDefinition.name,
          stageGroup: entry.processDefinition.stageGroup,
          position: entry.position,
          sequenceGroup: entry.sequenceGroup,
          ...productTimeStandardSnapshot(profile, entry),
          // A later publication that does not change this step's standard must
          // preserve the durable deployment marker that originally introduced
          // or changed it. Pure ordering changes do not claim a time change.
          productTimeDeploymentRouteId: changedTime ? input.deploymentRouteId : undefined,
          remark: entry.remark,
          quantityVersion: { increment: 1 },
        },
      });
      continue;
    }

    const hasDownstreamFacts = facts && downstreamHasFacts(route, entry, previous?.entries || []);
    const nextExistingEntry = profile.entries.find(candidate => (
      candidate.position > entry.position
      && currentByKey.has(candidate.occurrenceKey)
    ));
    const mustSupplement = facts && (hasDownstreamFacts || !nextExistingEntry);
    const standard = productTimeStandardSnapshot(profile, entry);
    const targetStep = nextExistingEntry ? currentByKey.get(nextExistingEntry.occurrenceKey) || null : null;
    const step = await tx.workOrderProcessStep.create({
      data: {
        routeId: route.id,
        processDefinitionId: entry.processDefinitionId,
        processCode: entry.processDefinition.code,
        processName: entry.processDefinition.name,
        stageGroup: entry.processDefinition.stageGroup,
        position: entry.position,
        sequenceGroup: entry.sequenceGroup,
        ...standard,
        productTimeDeploymentRouteId: input.deploymentRouteId,
        executionMode: mustSupplement
          ? ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION
          : ProcessStepExecutionMode.NORMAL,
        changeSource: ProcessRouteChangeStepSource.NEW,
        inputQty: 0,
        processedQty: 0,
        goodOutputQty: 0,
        defectOutputQty: 0,
        releasedGoodQty: 0,
        status: mustSupplement ? 'current' : 'pending',
        startedAt: mustSupplement ? new Date() : null,
        remark: entry.remark || (mustSupplement
          ? `产品工序与工时 V${profile.version} 新增补报义务；不参与数量释放`
          : `产品工序与工时 V${profile.version} 新增工序`),
      },
    });
    retainedIds.add(step.id);
    stepIdByKey.set(entry.occurrenceKey, step.id);
    insertedSteps.push({ stepId: step.id, insertBeforeStepId: targetStep?.id || null });
    stepChanges.push({
      stepId: step.id,
      kind: 'insert',
      previousStandardMillisecondsPerUnit: null,
    });
    if (mustSupplement) {
      const requiredQty = getProductionQuantitySummary(route.workOrder).targetQty;
      if (!requiredQty || requiredQty <= 0) {
        throw new ProductTimeDeploymentError(
          `工单 ${route.workOrder.code} 缺少有效生产数量，不能创建补充报工义务`,
          409,
          'PRODUCT_TIME_SUPPLEMENT_QUANTITY_REQUIRED',
        );
      }
      await tx.processSupplementObligation.create({
        data: {
          deploymentRouteId: input.deploymentRouteId,
          occurrenceKey: entry.occurrenceKey,
          workOrderId: route.workOrderId,
          routeId: route.id,
          displayStepId: step.id,
          insertBeforeStepId: targetStep?.id || null,
          processDefinitionId: entry.processDefinitionId,
          source: ProcessRouteChangeStepSource.NEW,
          processCode: entry.processDefinition.code,
          processName: entry.processDefinition.name,
          stageGroup: entry.processDefinition.stageGroup,
          displayPosition: entry.position,
          intendedSequenceGroup: entry.sequenceGroup,
          requiredQty,
          reportedQty: 0,
          status: ProcessSupplementObligationStatus.ACTIVE,
          releasePolicy: 'NONE',
          timeBasis: standard.timeBasis as string,
          unitLabel: standard.unitLabel || '件',
          standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit as number,
          setupMilliseconds: standard.setupMilliseconds,
          unitsPerProduct: standard.unitsPerProduct,
          countsForEfficiency: standard.countsForEfficiency,
        },
      });
      supplements += 1;
      if (routeState(route) === 'completed') reopened = true;
    }
  }

  for (const step of route.steps) {
    if (retainedIds.has(step.id)) continue;
    const retired = await retireRemovedStep(tx, step, input.deploymentRouteId);
    cancelledSupplement = cancelledSupplement || retired.cancelledSupplement;
  }
  for (const occurrenceKey of routeDrift.movedKeys) {
    const stepId = stepIdByKey.get(occurrenceKey);
    if (stepId) {
      stepChanges.push({
        stepId,
        kind: 'move',
        previousStandardMillisecondsPerUnit: null,
      });
    }
  }

  // Route facts can safely feed a newly inserted normal sequential group only
  // when its immediate downstream group has no facts. Redirect the input and
  // ledger once per new group; all other historical inserts are supplements.
  if (facts) {
    const insertedNormalGroups = new Map<number, ProductTimeProfileRecord['entries']>();
    for (const entry of insertedEntries) {
      const stepId = stepIdByKey.get(entry.occurrenceKey);
      const created = stepId ? await tx.workOrderProcessStep.findUnique({ where: { id: stepId } }) : null;
      if (!created || created.executionMode !== ProcessStepExecutionMode.NORMAL) continue;
      const group = insertedNormalGroups.get(entry.sequenceGroup) || [];
      group.push(entry);
      insertedNormalGroups.set(entry.sequenceGroup, group);
    }
    const redirectByTargetId = new Map<string, {
      sequenceGroup: number;
      entries: ProductTimeProfileRecord['entries'];
      target: DeploymentStepRecord;
    }>();
    for (const [sequenceGroup, entries] of insertedNormalGroups) {
      const next = profile.entries.find(entry => entry.sequenceGroup > sequenceGroup && currentByKey.has(entry.occurrenceKey));
      if (!next) continue;
      const target = currentByKey.get(next.occurrenceKey)!;
      const selected = redirectByTargetId.get(target.id);
      if (!selected || sequenceGroup < selected.sequenceGroup) {
        redirectByTargetId.set(target.id, { sequenceGroup, entries, target });
      }
    }
    for (const { sequenceGroup, entries, target } of redirectByTargetId.values()) {
      const targetSteps = route.steps.filter(step => step.sequenceGroup === target.sequenceGroup);
      const insertedStepIds = entries.map(entry => stepIdByKey.get(entry.occurrenceKey)).filter((id): id is string => Boolean(id));
      const transferred = await redirectSequentialInput(tx, {
        deploymentId: input.deploymentId,
        workOrderId: route.workOrderId,
        route,
        targetSteps,
        insertedStepIds,
        insertedSequenceGroup: sequenceGroup,
      });
      if (transferred > 0) {
        await tx.workOrderProcessStep.updateMany({
          where: { id: { in: insertedStepIds } },
          data: { inputQty: transferred, status: 'current', startedAt: new Date(), quantityVersion: { increment: 1 } },
        });
      }
    }
  } else {
    await tx.workOrderProcessStep.updateMany({
      where: {
        routeId: route.id,
        retiredAt: null,
        executionMode: ProcessStepExecutionMode.NORMAL,
      },
      data: {
        inputQty: 0,
        processedQty: 0,
        goodOutputQty: 0,
        defectOutputQty: 0,
        releasedGoodQty: 0,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        completedById: null,
        quantityVersion: { increment: 1 },
      },
    });
    const firstGroup = profile.entries[0]?.sequenceGroup;
    const targetQty = getProductionQuantitySummary(route.workOrder).targetQty || 0;
    const firstIds = profile.entries
      .filter(entry => entry.sequenceGroup === firstGroup)
      .map(entry => stepIdByKey.get(entry.occurrenceKey))
      .filter((id): id is string => Boolean(id));
    if (firstIds.length) {
      await tx.workOrderProcessStep.updateMany({
        where: { id: { in: firstIds } },
        data: {
          inputQty: targetQty,
          status: route.startedAt ? 'current' : 'pending',
          startedAt: route.startedAt,
          quantityVersion: { increment: 1 },
        },
      });
    }
  }

  let closedAfterSupplementCancellation = false;
  if (cancelledSupplement && supplements === 0) {
    const [activeSupplements, unfinishedNormalSteps] = await Promise.all([
      tx.processSupplementObligation.count({
        where: { routeId: route.id, status: ProcessSupplementObligationStatus.ACTIVE },
      }),
      tx.workOrderProcessStep.count({
        where: {
          routeId: route.id,
          retiredAt: null,
          executionMode: ProcessStepExecutionMode.NORMAL,
          status: { notIn: ['completed', 'skipped'] },
        },
      }),
    ]);
    if (activeSupplements === 0 && unfinishedNormalSteps === 0) {
      const completedAt = new Date();
      await tx.workOrderProcessRoute.update({
        where: { id: route.id },
        data: { status: 'completed', completedAt },
      });
      await tx.workOrder.update({
        where: { id: route.workOrderId },
        data: {
          stage: 'completed',
          status: 'done',
          progress: 100,
          completedAt,
          lastProgressAt: completedAt,
          latestProgressRemark: '已取消退役的补充工序；其余工序均已完成',
          executionVersion: { increment: 1 },
        },
      });
      closedAfterSupplementCancellation = true;
    }
  }
  if (reopened) {
    await tx.workOrderProcessRoute.update({
      where: { id: route.id },
      data: { status: 'in_progress', completedAt: null },
    });
    await tx.workOrder.update({
      where: { id: route.workOrderId },
      data: {
        status: 'processing',
        completedAt: null,
        progress: Math.min(route.workOrder.progress, 99),
        latestProgressRemark: `产品工序与工时 V${profile.version} 新增补充报工义务`,
      },
    });
  }
  const taskSync = await syncDailyTasksAfterProcessRouteChange(tx, {
    changeId: `product-time-deployment:${input.deploymentId}`,
    routeId: route.id,
    actorId: input.actorId,
    insertedSteps,
    timeChangedStepIds,
    reason: `产品工序与工时 V${profile.version} 发布，同步全部工单与二维码`,
  });
  const routeAfter = await tx.workOrderProcessRoute.findUniqueOrThrow({
    where: { id: route.id },
    select: { version: true },
  });
  const result = {
    insertedProcesses: insertedEntries.length,
    movedProcesses: routeDrift.movedKeys.size,
    updatedTimes: timeChangedStepIds.length,
    historicalReports: correctedReports,
    affectedEmployees: affectedEmployeeIds.size,
    supplementObligations: supplements,
    reopened,
    closedAfterSupplementCancellation,
    taskSync,
    stepChanges,
  };
  await tx.processRouteActivity.create({
    data: {
      routeId: route.id,
      action: 'product_time_deployed',
      content: `产品工序与工时 V${profile.version} 已同步到路线、生产执行和二维码`,
      actorId: input.actorId,
      detail: { deploymentId: input.deploymentId, ...result },
    },
  });
  return { result, routeVersionAfter: routeAfter.version };
}

function deploymentStatus(status: ProductTimeDeploymentStatus): ProductTimeDeploymentDTO['status'] {
  if (status === ProductTimeDeploymentStatus.ACTIVE) return 'active';
  if (status === ProductTimeDeploymentStatus.APPLYING) return 'applying';
  if (status === ProductTimeDeploymentStatus.FAILED) return 'failed';
  return 'pending';
}

function routeDeploymentStatus(status: ProductTimeDeploymentRouteStatus): ProductTimeDeploymentRouteDTO['status'] {
  if (status === ProductTimeDeploymentRouteStatus.APPLYING) return 'applying';
  if (status === ProductTimeDeploymentRouteStatus.SUCCEEDED) return 'succeeded';
  if (status === ProductTimeDeploymentRouteStatus.FAILED) return 'failed';
  if (status === ProductTimeDeploymentRouteStatus.BLOCKED) return 'blocked';
  if (status === ProductTimeDeploymentRouteStatus.UNCHANGED) return 'unchanged';
  return 'pending';
}

function serializeDeployment(record: DeploymentRecord): ProductTimeDeploymentDTO {
  return {
    id: record.id,
    itemId: record.drawingLibraryItemId,
    profileId: record.profileId,
    profileVersion: record.profileVersion,
    status: deploymentStatus(record.status),
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() || null,
    error: record.error,
    impact: jsonRecord(record.impact) as unknown as ProductTimeDeploymentImpactDTO,
    diffs: jsonArray<ProductTimeDeploymentDiffDTO>(record.diffs),
    conflicts: jsonArray<ProductTimeDeploymentConflictDTO>(record.conflicts),
    routes: record.routes.map(route => {
      const result = jsonRecord(route.result);
      return {
        workOrderId: route.workOrderId,
        workOrderCode: route.workOrder.code,
        state: route.workOrderState as ProductTimeDeploymentRouteDTO['state'],
        status: routeDeploymentStatus(route.status),
        qrUpdated: route.status === ProductTimeDeploymentRouteStatus.SUCCEEDED && Boolean(route.workOrder.qrTicket),
        routeVersionBefore: route.routeVersionBefore,
        routeVersionAfter: route.routeVersionAfter,
        insertedProcesses: Number(result.insertedProcesses || 0),
        movedProcesses: Number(result.movedProcesses || 0),
        updatedTimes: Number(result.updatedTimes || 0),
        historicalReports: Number(result.historicalReports || 0),
        affectedEmployees: Number(result.affectedEmployees || 0),
        supplementObligations: Number(result.supplementObligations || 0),
        error: route.error,
      };
    }),
  };
}

export async function getProductTimeDeployment(id: string): Promise<ProductTimeDeploymentDTO | null> {
  const record = await prisma.productTimeDeployment.findUnique({
    where: { id },
    include: deploymentInclude,
  });
  return record ? serializeDeployment(record) : null;
}

async function recordFailedDeployment(
  preview: ProductTimeDeploymentPreviewDTO,
  actorId: string,
  error: Error,
) {
  const profile = await prisma.productTimeProfile.findUnique({
    where: { id: preview.draftProfileId },
    select: { id: true, revision: true, status: true },
  });
  if (!profile) return null;
  const existing = await prisma.productTimeDeployment.findUnique({
    where: { profileId: profile.id },
    select: { id: true, status: true },
  });
  if (existing?.status === ProductTimeDeploymentStatus.ACTIVE) return existing.id;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${preview.itemId}`}))`;
    const current = await tx.productTimeDeployment.findUnique({
      where: { profileId: profile.id },
      select: { id: true, status: true },
    });
    if (current?.status === ProductTimeDeploymentStatus.ACTIVE) return current.id;
    if (current) {
      await tx.productTimeDeploymentRoute.deleteMany({ where: { deploymentId: current.id } });
      await tx.productTimeDeployment.update({
        where: { id: current.id },
        data: {
          expectedRevision: profile.revision,
          previewToken: preview.previewToken,
          idempotencyKey: `product-time:${profile.id}:${profile.revision}`,
          status: ProductTimeDeploymentStatus.FAILED,
          impact: preview.impact as unknown as Prisma.InputJsonValue,
          diffs: preview.diffs as unknown as Prisma.InputJsonValue,
          conflicts: preview.conflicts as unknown as Prisma.InputJsonValue,
          actorId,
          error: error.message.slice(0, 2_000),
          startedAt: null,
          completedAt: new Date(),
        },
      });
    } else {
      await tx.productTimeDeployment.create({
        data: {
          drawingLibraryItemId: preview.itemId,
          profileId: profile.id,
          profileVersion: preview.toVersion,
          expectedRevision: profile.revision,
          previewToken: preview.previewToken,
          idempotencyKey: `product-time:${profile.id}:${profile.revision}`,
          status: ProductTimeDeploymentStatus.FAILED,
          impact: preview.impact as unknown as Prisma.InputJsonValue,
          diffs: preview.diffs as unknown as Prisma.InputJsonValue,
          conflicts: preview.conflicts as unknown as Prisma.InputJsonValue,
          actorId,
          error: error.message.slice(0, 2_000),
          completedAt: new Date(),
        },
      });
    }
    const deployment = await tx.productTimeDeployment.findUniqueOrThrow({ where: { profileId: profile.id } });
    const routes = await tx.workOrderProcessRoute.findMany({
      where: { workOrder: { drawingLibraryItemId: preview.itemId, deletedAt: null, branchType: null } },
      select: { id: true, version: true, workOrderId: true, workOrder: { select: { code: true } } },
    });
    for (const route of routes) {
      const previewRoute = preview.routes.find(item => item.workOrderId === route.workOrderId);
      await tx.productTimeDeploymentRoute.create({
        data: {
          deploymentId: deployment.id,
          workOrderId: route.workOrderId,
          routeId: route.id,
          workOrderState: previewRoute?.state || 'in_progress',
          status: previewRoute?.status === 'blocked'
            ? ProductTimeDeploymentRouteStatus.BLOCKED
            : ProductTimeDeploymentRouteStatus.FAILED,
          routeVersionBefore: previewRoute?.routeVersionBefore ?? route.version,
          error: error.message.slice(0, 2_000),
        },
      });
    }
    return deployment.id;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
  });
}

export async function publishProductTimeDeployment(input: {
  itemId: string;
  actorId: string;
  expectedRevision: number;
  previewToken: string;
}): Promise<{ profileId: string; deployment: ProductTimeDeploymentDTO }> {
  let outside: ProductTimeDeploymentPreviewDTO;
  try {
    outside = await previewProductTimeDeployment(input.itemId);
  } catch (error) {
    if (error instanceof ProductTimeDeploymentError && error.code === 'DRAFT_NOT_FOUND') {
      const active = await prisma.productTimeDeployment.findFirst({
        where: {
          drawingLibraryItemId: input.itemId,
          previewToken: input.previewToken,
          expectedRevision: input.expectedRevision,
          status: ProductTimeDeploymentStatus.ACTIVE,
        },
        orderBy: { completedAt: 'desc' },
        include: deploymentInclude,
      });
      if (active) return { profileId: active.profileId, deployment: serializeDeployment(active) };
    }
    throw error;
  }
  if (outside.draftProfileId && outside.previewToken !== input.previewToken) {
    throw new ProductTimeDeploymentError('发布预览已过期，请重新预览', 409, 'PRODUCT_TIME_PREVIEW_STALE');
  }
  if (!outside.canPublish) {
    throw new ProductTimeDeploymentError('存在阻断冲突，不能发布', 409, 'PRODUCT_TIME_DEPLOYMENT_BLOCKED');
  }
  let deploymentId: string;
  try {
    for (let transactionAttempt = 0; ; transactionAttempt += 1) {
      try {
        deploymentId = await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${input.itemId}`}))`;
          const alreadyActive = await tx.productTimeDeployment.findFirst({
            where: {
              profileId: outside.draftProfileId,
              previewToken: input.previewToken,
              expectedRevision: input.expectedRevision,
              status: ProductTimeDeploymentStatus.ACTIVE,
            },
            select: { id: true },
          });
          if (alreadyActive) return alreadyActive.id;
          const context = await loadPreviewContext(tx, input.itemId, 'draft');
          const currentPreview = previewFromContext(input.itemId, context);
          if (context.profile.revision !== input.expectedRevision) {
            throw new ProductTimeDeploymentError('产品工序与工时已被修改，请刷新后重试', 409, 'PRODUCT_TIME_CONFLICT');
          }
          if (currentPreview.previewToken !== input.previewToken) {
            throw new ProductTimeDeploymentError('发布预览已过期，请重新预览', 409, 'PRODUCT_TIME_PREVIEW_STALE');
          }
          if (!currentPreview.canPublish) {
            throw new ProductTimeDeploymentError('存在阻断冲突，不能发布', 409, 'PRODUCT_TIME_DEPLOYMENT_BLOCKED');
          }
          const existing = await tx.productTimeDeployment.findUnique({
            where: { profileId: context.profile.id },
            include: deploymentInclude,
          });
          if (existing?.status === ProductTimeDeploymentStatus.ACTIVE) return existing.id;
          if (existing) await tx.productTimeDeploymentRoute.deleteMany({ where: { deploymentId: existing.id } });
          const deployment = existing
            ? await tx.productTimeDeployment.update({
                where: { id: existing.id },
                data: {
                  baseProfileId: context.previous?.id || null,
                  profileVersion: context.profile.version,
                  expectedRevision: context.profile.revision,
                  previewToken: currentPreview.previewToken,
                  idempotencyKey: `product-time:${context.profile.id}:${context.profile.revision}`,
                  status: ProductTimeDeploymentStatus.APPLYING,
                  impact: currentPreview.impact as unknown as Prisma.InputJsonValue,
                  diffs: currentPreview.diffs as unknown as Prisma.InputJsonValue,
                  conflicts: currentPreview.conflicts as unknown as Prisma.InputJsonValue,
                  actorId: input.actorId,
                  error: null,
                  startedAt: new Date(),
                  completedAt: null,
                },
              })
            : await tx.productTimeDeployment.create({
                data: {
                  drawingLibraryItemId: input.itemId,
                  profileId: context.profile.id,
                  baseProfileId: context.previous?.id || null,
                  profileVersion: context.profile.version,
                  expectedRevision: context.profile.revision,
                  previewToken: currentPreview.previewToken,
                  idempotencyKey: `product-time:${context.profile.id}:${context.profile.revision}`,
                  status: ProductTimeDeploymentStatus.APPLYING,
                  impact: currentPreview.impact as unknown as Prisma.InputJsonValue,
                  diffs: currentPreview.diffs as unknown as Prisma.InputJsonValue,
                  conflicts: currentPreview.conflicts as unknown as Prisma.InputJsonValue,
                  actorId: input.actorId,
                  startedAt: new Date(),
                },
              });
          for (const route of context.routes) {
            const ledger = await tx.productTimeDeploymentRoute.create({
              data: {
                deploymentId: deployment.id,
                workOrderId: route.workOrderId,
                routeId: route.id,
                workOrderState: routeState(route),
                status: ProductTimeDeploymentRouteStatus.APPLYING,
                routeVersionBefore: route.version,
              },
            });
            const applied = await applyRouteDeployment(tx, {
              deploymentId: deployment.id,
              deploymentRouteId: ledger.id,
              actorId: input.actorId,
              profile: context.profile,
              previous: context.previous,
              route,
              diffs: currentPreview.diffs,
            });
            await tx.productTimeDeploymentRoute.update({
              where: { id: ledger.id },
              data: {
                status: ProductTimeDeploymentRouteStatus.SUCCEEDED,
                routeVersionAfter: applied.routeVersionAfter,
                result: applied.result as unknown as Prisma.InputJsonValue,
              },
            });
          }
          await tx.productTimeProfile.updateMany({
            where: { drawingLibraryItemId: input.itemId, status: 'published' },
            data: { status: 'archived', updatedById: input.actorId },
          });
          const profileUpdate = await tx.productTimeProfile.updateMany({
            where: {
              id: context.profile.id,
              revision: context.profile.revision,
              status: 'draft',
            },
            data: {
              status: 'published',
              revision: { increment: 1 },
              publishedAt: new Date(),
              publishedById: input.actorId,
              updatedById: input.actorId,
            },
          });
          if (profileUpdate.count !== 1) {
            throw new ProductTimeDeploymentError('产品工序与工时已被修改，请刷新后重试', 409, 'PRODUCT_TIME_CONFLICT');
          }
          await tx.productTimeDeployment.update({
            where: { id: deployment.id },
            data: { status: ProductTimeDeploymentStatus.ACTIVE, completedAt: new Date() },
          });
          await tx.operationLog.create({
            data: {
              userId: input.actorId,
              action: 'publish_product_time_full_deployment',
              targetType: 'product_time_deployment',
              targetId: deployment.id,
              detail: {
                drawingLibraryItemId: input.itemId,
                profileId: context.profile.id,
                profileVersion: context.profile.version,
                routeCount: context.routes.length,
                impact: currentPreview.impact,
              },
            },
          });
          return deployment.id;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 120_000,
        });
        break;
      } catch (error) {
        // PostgreSQL takes the Serializable snapshot before a waiting advisory
        // lock is granted. A concurrent publisher may therefore commit while
        // this transaction waits, making the first snapshot stale. Retrying the
        // whole transaction creates a fresh snapshot; the ACTIVE replay check
        // then returns the already committed deployment idempotently.
        if (transactionAttempt < 2 && isRetryableSerializableConflict(error)) continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof ProductTimeDeploymentError && [
      'PRODUCT_TIME_CONFLICT',
      'PRODUCT_TIME_PREVIEW_STALE',
      'PRODUCT_TIME_DEPLOYMENT_BLOCKED',
    ].includes(error.code)) throw error;
    const failure = error instanceof Error ? error : new Error('产品工序与工时部署失败');
    const failedDeploymentId = await recordFailedDeployment(outside, input.actorId, failure).catch(recordError => {
      console.error('record failed product time deployment failed', recordError);
      return null;
    });
    const failedDeployment = failedDeploymentId
      ? await getProductTimeDeployment(failedDeploymentId)
      : null;
    if (error instanceof ProductTimeDeploymentError) {
      throw new ProductTimeDeploymentError(
        error.message,
        error.status,
        error.code,
        failedDeployment || undefined,
      );
    }
    throw new ProductTimeDeploymentError(
      failure.message,
      500,
      'PRODUCT_TIME_DEPLOYMENT_FAILED',
      failedDeployment || undefined,
    );
  }
  const deployment = await getProductTimeDeployment(deploymentId);
  if (!deployment) throw new ProductTimeDeploymentError('部署结果不存在', 500, 'PRODUCT_TIME_DEPLOYMENT_MISSING');
  return { profileId: outside.draftProfileId, deployment };
}

export async function retryProductTimeDeployment(input: {
  deploymentId: string;
  actorId: string;
  workOrderIds?: string[];
}): Promise<ProductTimeDeploymentDTO> {
  const failed = await prisma.productTimeDeployment.findUnique({
    where: { id: input.deploymentId },
    select: {
      id: true,
      drawingLibraryItemId: true,
      profileId: true,
      status: true,
      expectedRevision: true,
    },
  });
  if (!failed) throw new ProductTimeDeploymentError('部署记录不存在', 404, 'PRODUCT_TIME_DEPLOYMENT_NOT_FOUND');
  if (failed.status === ProductTimeDeploymentStatus.ACTIVE) {
    const active = await getProductTimeDeployment(failed.id);
    if (!active) throw new ProductTimeDeploymentError('部署记录不存在', 404, 'PRODUCT_TIME_DEPLOYMENT_NOT_FOUND');
    return active;
  }
  if (failed.status !== ProductTimeDeploymentStatus.FAILED) {
    throw new ProductTimeDeploymentError('只有失败的部署可以重试', 409, 'PRODUCT_TIME_DEPLOYMENT_NOT_RETRYABLE');
  }
  const profile = await prisma.productTimeProfile.findUnique({
    where: { id: failed.profileId },
    select: { status: true },
  });
  if (profile?.status === 'published') {
    return reconcilePublishedProductTimeDeployment({
      itemId: failed.drawingLibraryItemId,
      actorId: input.actorId,
    });
  }
  // A failed all-or-nothing transaction applied zero routes. The optional UI
  // subset is therefore intentionally advisory: retry always revalidates and
  // reruns the complete product scope so no route is silently omitted.
  const preview = await previewProductTimeDeployment(failed.drawingLibraryItemId);
  const result = await publishProductTimeDeployment({
    itemId: failed.drawingLibraryItemId,
    actorId: input.actorId,
    expectedRevision: failed.expectedRevision,
    previewToken: preview.previewToken,
  });
  return result.deployment;
}

/**
 * Compatibility entrypoint for profiles published before the deployment
 * ledger existed. It performs the same all-route transaction but does not
 * create a new product profile version or archive the current one.
 */
export async function reconcilePublishedProductTimeDeployment(input: {
  itemId: string;
  actorId: string;
}): Promise<ProductTimeDeploymentDTO> {
  const published = await prisma.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: input.itemId, status: 'published' },
    orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  });
  if (!published) {
    throw new ProductTimeDeploymentError(
      '没有已发布的产品工序与工时版本',
      404,
      'PUBLISHED_PROFILE_NOT_FOUND',
    );
  }
  const existing = await prisma.productTimeDeployment.findUnique({
    where: { profileId: published.id },
    include: deploymentInclude,
  });
  if (existing?.status === ProductTimeDeploymentStatus.ACTIVE) return serializeDeployment(existing);

  const deploymentId = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${input.itemId}`}))`;
    const context = await loadPreviewContext(tx, input.itemId, 'published');
    const preview = previewFromContext(input.itemId, context);
    if (!preview.canPublish) {
      throw new ProductTimeDeploymentError(
        '存在阻断冲突，不能校准已发布版本',
        409,
        'PRODUCT_TIME_DEPLOYMENT_BLOCKED',
      );
    }
    const current = await tx.productTimeDeployment.findUnique({ where: { profileId: context.profile.id } });
    if (current?.status === ProductTimeDeploymentStatus.ACTIVE) return current.id;
    if (current) await tx.productTimeDeploymentRoute.deleteMany({ where: { deploymentId: current.id } });
    const deployment = current
      ? await tx.productTimeDeployment.update({
          where: { id: current.id },
          data: {
            baseProfileId: context.previous?.id || null,
            profileVersion: context.profile.version,
            expectedRevision: context.profile.revision,
            previewToken: preview.previewToken,
            idempotencyKey: `product-time-reconcile:${context.profile.id}:${context.profile.revision}`,
            status: ProductTimeDeploymentStatus.APPLYING,
            impact: preview.impact as unknown as Prisma.InputJsonValue,
            diffs: preview.diffs as unknown as Prisma.InputJsonValue,
            conflicts: preview.conflicts as unknown as Prisma.InputJsonValue,
            actorId: input.actorId,
            error: null,
            startedAt: new Date(),
            completedAt: null,
          },
        })
      : await tx.productTimeDeployment.create({
          data: {
            drawingLibraryItemId: input.itemId,
            profileId: context.profile.id,
            baseProfileId: context.previous?.id || null,
            profileVersion: context.profile.version,
            expectedRevision: context.profile.revision,
            previewToken: preview.previewToken,
            idempotencyKey: `product-time-reconcile:${context.profile.id}:${context.profile.revision}`,
            status: ProductTimeDeploymentStatus.APPLYING,
            impact: preview.impact as unknown as Prisma.InputJsonValue,
            diffs: preview.diffs as unknown as Prisma.InputJsonValue,
            conflicts: preview.conflicts as unknown as Prisma.InputJsonValue,
            actorId: input.actorId,
            startedAt: new Date(),
          },
        });
    for (const route of context.routes) {
      const ledger = await tx.productTimeDeploymentRoute.create({
        data: {
          deploymentId: deployment.id,
          workOrderId: route.workOrderId,
          routeId: route.id,
          workOrderState: routeState(route),
          status: ProductTimeDeploymentRouteStatus.APPLYING,
          routeVersionBefore: route.version,
        },
      });
      const applied = await applyRouteDeployment(tx, {
        deploymentId: deployment.id,
        deploymentRouteId: ledger.id,
        actorId: input.actorId,
        profile: context.profile,
        previous: context.previous,
        route,
        diffs: preview.diffs,
      });
      await tx.productTimeDeploymentRoute.update({
        where: { id: ledger.id },
        data: {
          status: ProductTimeDeploymentRouteStatus.SUCCEEDED,
          routeVersionAfter: applied.routeVersionAfter,
          result: applied.result as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await tx.productTimeDeployment.update({
      where: { id: deployment.id },
      data: { status: ProductTimeDeploymentStatus.ACTIVE, completedAt: new Date() },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'reconcile_published_product_time_full_deployment',
        targetType: 'product_time_deployment',
        targetId: deployment.id,
        detail: {
          drawingLibraryItemId: input.itemId,
          profileId: context.profile.id,
          profileVersion: context.profile.version,
          routeCount: context.routes.length,
        },
      },
    });
    return deployment.id;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
  });
  const deployment = await getProductTimeDeployment(deploymentId);
  if (!deployment) throw new ProductTimeDeploymentError('部署结果不存在', 500, 'PRODUCT_TIME_DEPLOYMENT_MISSING');
  return deployment;
}
