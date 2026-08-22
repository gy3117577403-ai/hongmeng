import { createHash } from 'node:crypto';
import {
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessMovementType,
  ProcessRouteChangeStatus,
  ProcessRouteChangeStepSource,
  ProcessStepExecutionMode,
  ProcessSupplementFulfillmentMode,
  ProcessSupplementObligationStatus,
  ProductTimeDeploymentRouteStatus,
  ProductTimeDeploymentStatus,
} from '@prisma/client';
import {
  calculateCompletionLaborSnapshot,
  redistributeStandardLaborByExistingShares,
} from '@/lib/process-completion-domain';
import { calculateAttainmentBasisPoints } from '@/lib/process-time';
import {
  productTimeProfileInclude,
  productTimeStandardSnapshot,
  type ProductTimeProfileRecord,
} from '@/lib/product-time';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import {
  normalizeProductTimeInsertPolicies,
  projectProductTimeCoverage,
  type ProductTimeCoverageProjection,
  type ProductTimeInsertPolicy,
} from '@/lib/process-supplement-coverage';
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
  isCritical?: boolean;
  policy?: ProductTimeInsertPolicy | null;
  policyRequired?: boolean;
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
  systemCoveredQty?: number;
  actualRequiredQty?: number;
  fulfillmentModes?: string[];
  error?: string | null;
};

export type ProductTimeDeploymentImpactDTO = {
  workOrders: { total: number; unstarted: number; inProgress: number; completed: number };
  historicalReports: number;
  affectedEmployees: number;
  attainmentRecords: number;
  supplementObligations: number;
  keptCompleted: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  generatedLaborRecords: number;
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
          systemCoveredQty: true,
          reportedQty: true,
          fulfillmentMode: true,
          releasePolicy: true,
          isCritical: true,
        },
      },
      completions: {
        where: { voidedAt: null },
        select: {
          id: true,
          principalEmployeeId: true,
          completedAt: true,
          processedQty: true,
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
    reportQuantityBasis: entry.reportQuantityBasis === 'action' && actionBased
      ? 'action' as const
      : 'product' as const,
    reportUnitLabel: entry.reportQuantityBasis === 'action' && actionBased
      ? entry.reportUnitLabel || '个'
      : entry.unitLabel,
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
    && first.reportQuantityBasis === second.reportQuantityBasis
    && first.reportUnitLabel === second.reportUnitLabel
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
    && (stepHasFacts(step) || (
      step.reportQuantityBasis === standard.reportQuantityBasis
      && step.reportUnitLabel === standard.reportUnitLabel
    ))
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
  policies: Record<string, ProductTimeInsertPolicy> = {},
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
      const requestedPolicy = policies[entry.occurrenceKey] || null;
      const policy = entry.isCritical
        ? requestedPolicy === 'FUTURE_ONLY' || requestedPolicy === 'RECALL_REWORK'
          ? requestedPolicy
          : null
        : requestedPolicy || 'AUTO_BY_PROGRESS';
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
        isCritical: entry.isCritical,
        policy,
        policyRequired: entry.isCritical && !policy,
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

function stepProgressQuantity(step: DeploymentStepRecord): number {
  const completionQty = step.completions.reduce((total, completion) => total + completion.processedQty, 0);
  return Math.max(
    step.processedQty,
    step.goodOutputQty + step.defectOutputQty,
    step.releasedGoodQty,
    completionQty,
  );
}

type CoverageBoundary = {
  hasNextExistingStep: boolean;
  downstreamHasFacts: boolean;
  boundaryProgressQty: number;
  evidence: Record<string, unknown>;
  conflict?: { code: string; message: string };
};

function coverageBoundaryForEntry(
  route: DeploymentRouteRecord,
  profile: ProductTimeProfileRecord,
  previous: ProductTimeProfileRecord | null,
  entry: ProductTimeProfileRecord['entries'][number],
  currentByKey: Map<string, DeploymentStepRecord>,
  targetQty: number,
): CoverageBoundary {
  const downstreamFacts = downstreamHasFacts(route, entry, previous?.entries || []);
  if (routeState(route) === 'completed') {
    return {
      hasNextExistingStep: profile.entries.some(candidate => (
        candidate.position > entry.position && currentByKey.has(candidate.occurrenceKey)
      )),
      downstreamHasFacts: true,
      boundaryProgressQty: targetQty,
      evidence: { boundaryType: 'COMPLETED_ROUTE', targetQty, routeVersion: route.version },
    };
  }

  const next = profile.entries.find(candidate => (
    candidate.position > entry.position && currentByKey.has(candidate.occurrenceKey)
  ));
  const boundaryEntries = next
    ? profile.entries.filter(candidate => (
        candidate.sequenceGroup === next.sequenceGroup && currentByKey.has(candidate.occurrenceKey)
      ))
    : (() => {
        const previousEntries = profile.entries.filter(candidate => (
          candidate.position < entry.position && currentByKey.has(candidate.occurrenceKey)
        ));
        const previousGroup = previousEntries.at(-1)?.sequenceGroup;
        return previousGroup == null
          ? []
          : previousEntries.filter(candidate => candidate.sequenceGroup === previousGroup);
      })();
  const boundarySteps = boundaryEntries
    .map(candidate => currentByKey.get(candidate.occurrenceKey))
    .filter((step): step is DeploymentStepRecord => Boolean(step));
  const progressValues = boundarySteps.map(step => stepProgressQuantity(step));
  const distinctProgress = [...new Set(progressValues)];
  if (distinctProgress.length > 1) {
    return {
      hasNextExistingStep: Boolean(next),
      downstreamHasFacts: downstreamFacts,
      boundaryProgressQty: 0,
      evidence: {
        boundaryType: next ? 'NEXT_PARALLEL_GROUP' : 'PREVIOUS_PARALLEL_GROUP',
        stepIds: boundarySteps.map(step => step.id),
        progressValues,
        routeVersion: route.version,
      },
      conflict: {
        code: 'PRODUCT_TIME_INSERT_PARALLEL_PROGRESS_CONFLICT',
        message: `${entry.processDefinition.name} 插入点相邻并行工序的已完成数量不一致，不能自动判定历史承接数量`,
      },
    };
  }
  const completedQty = getProductionQuantitySummary(route.workOrder).completedQty || 0;
  const boundaryProgressQty = Math.max(progressValues[0] || 0, next ? 0 : completedQty);
  const laterProgressQty = next
    ? Math.max(0, ...profile.entries
        .filter(candidate => candidate.position > entry.position)
        .map(candidate => currentByKey.get(candidate.occurrenceKey))
        .filter((step): step is DeploymentStepRecord => Boolean(step))
        .map(stepProgressQuantity))
    : boundaryProgressQty;
  if (boundaryProgressQty > targetQty || laterProgressQty > targetQty || laterProgressQty > boundaryProgressQty) {
    return {
      hasNextExistingStep: Boolean(next),
      downstreamHasFacts: downstreamFacts,
      boundaryProgressQty: 0,
      evidence: {
        boundaryType: next ? 'NEXT_GROUP' : 'PREVIOUS_GROUP',
        stepIds: boundarySteps.map(step => step.id),
        progressValues,
        completedQty,
        boundaryProgressQty,
        laterProgressQty,
        targetQty,
        routeVersion: route.version,
      },
      conflict: {
        code: 'PRODUCT_TIME_INSERT_PROGRESS_LEDGER_CONFLICT',
        message: `${entry.processDefinition.name} 插入点的历史进度与后序数量台账不一致，不能自动承接`,
      },
    };
  }
  return {
    hasNextExistingStep: Boolean(next),
    downstreamHasFacts: downstreamFacts,
    boundaryProgressQty,
    evidence: {
      boundaryType: next ? 'NEXT_GROUP' : 'PREVIOUS_GROUP',
      stepIds: boundarySteps.map(step => step.id),
      progressValues,
      completedQty,
      boundaryProgressQty,
      targetQty,
      routeVersion: route.version,
    },
  };
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
  if (
    profileStatus === 'draft'
    && previous
    && profile.version <= previous.version
  ) {
    throw new ProductTimeDeploymentError(
      `当前草稿 V${profile.version} 已落后正式版本 V${previous.version}，请先同步最新正式版后再发布`,
      409,
      'PRODUCT_TIME_DRAFT_STALE',
    );
  }
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
  policiesInput: unknown = {},
): ProductTimeDeploymentPreviewDTO {
  const { profile, previous, routes } = context;
  const policies = normalizeProductTimeInsertPolicies(policiesInput);
  const diffs = buildDiffs(previous, profile, policies);
  const conflicts: ProductTimeDeploymentConflictDTO[] = [];
  for (const diff of diffs) {
    if (diff.kind !== 'insert' || !diff.policyRequired) continue;
    conflicts.push({
      code: 'CRITICAL_PROCESS_POLICY_REQUIRED',
      message: `${diff.processName} 已标记为安全/质量关键工序，发布前必须明确选择“仅未来/未开工产品生效”或“召回返工”`,
    });
  }
  const nextByKey = new Map(profile.entries.map(entry => [entry.occurrenceKey, entry] as const));
  let supplementObligations = 0;
  let keptCompleted = 0;
  let systemCoveredQty = 0;
  let actualRequiredQty = 0;
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
    const targetQty = getProductionQuantitySummary(route.workOrder).targetQty || 0;
    const projections: ProductTimeCoverageProjection[] = [];
    if (drift.createdEntries.length && targetQty <= 0) {
      conflicts.push({
        code: 'PRODUCT_TIME_SUPPLEMENT_QUANTITY_REQUIRED',
        message: `工单 ${route.workOrder.code} 缺少有效生产数量，不能计算新增工序的历史承接边界`,
        workOrderId: route.workOrderId,
        workOrderCode: route.workOrder.code,
      });
    } else {
      for (const entry of drift.createdEntries) {
        const diff = diffs.find(item => item.kind === 'insert' && item.occurrenceKey === entry.occurrenceKey);
        const policy = diff?.policy
          || (!entry.isCritical ? 'AUTO_BY_PROGRESS' : policies[entry.occurrenceKey]);
        if (!policy) {
          conflicts.push({
            code: 'CRITICAL_PROCESS_POLICY_REQUIRED',
            message: `${entry.processDefinition.name} 是关键工序且该路线缺少对应工序，必须先明确历史路线处理策略`,
            workOrderId: route.workOrderId,
            workOrderCode: route.workOrder.code,
          });
          continue;
        }
        const boundary = coverageBoundaryForEntry(
          route,
          profile,
          previous,
          entry,
          drift.currentByKey,
          targetQty,
        );
        if (boundary.conflict) {
          conflicts.push({
            ...boundary.conflict,
            workOrderId: route.workOrderId,
            workOrderCode: route.workOrder.code,
          });
          continue;
        }
        projections.push(projectProductTimeCoverage({
          routeTargetQty: targetQty,
          routeHasFacts: routeFacts,
          routeCompleted: state === 'completed',
          hasNextExistingStep: boundary.hasNextExistingStep,
          downstreamHasFacts: boundary.downstreamHasFacts,
          boundaryProgressQty: boundary.boundaryProgressQty,
          policy,
        }));
      }
    }
    const routeSupplements = projections.filter(item => item.execution === 'supplement').length;
    const routeSystemCoveredQty = projections.reduce((sum, item) => sum + item.systemCoveredQty, 0);
    const routeActualRequiredQty = projections.reduce((sum, item) => sum + item.actualRequiredQty, 0);
    const fulfillmentModes = [...new Set(projections.map(item => item.fulfillmentMode))];
    supplementObligations += routeSupplements;
    systemCoveredQty += routeSystemCoveredQty;
    actualRequiredQty += routeActualRequiredQty;
    if (
      state === 'completed'
      && drift.createdEntries.length > 0
      && projections.length === drift.createdEntries.length
      && projections.every(item => !item.shouldReopenCompletedRoute)
    ) {
      keptCompleted += 1;
    }
    return {
      workOrderId: route.workOrderId,
      workOrderCode: route.workOrder.code,
      state,
      status: conflicts.some(item => !item.workOrderId || item.workOrderId === route.workOrderId)
        ? 'blocked' as const
        : 'pending' as const,
      qrUpdated: false,
      routeVersionBefore: route.version,
      routeVersionAfter: null,
      insertedProcesses: drift.createdEntries.length,
      movedProcesses: drift.movedKeys.size,
      updatedTimes: drift.timeChangedEntries.length,
      historicalReports: routeReports,
      affectedEmployees: routeEmployees.size,
      supplementObligations: routeSupplements,
      systemCoveredQty: routeSystemCoveredQty,
      actualRequiredQty: routeActualRequiredQty,
      fulfillmentModes,
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
    keptCompleted,
    systemCoveredQty,
    actualRequiredQty,
    generatedLaborRecords: 0,
    qrTickets: routes.filter(route => route.workOrder.qrTicket?.status === 'ACTIVE').length,
    conflicts: conflicts.length,
  };
  const token = previewToken({
    itemId,
    profileId: profile.id,
    profileRevision: profile.revision,
    profileVersion: profile.version,
    previousProfileId: previous?.id || null,
    policies,
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
  policiesInput: unknown = {},
): Promise<ProductTimeDeploymentPreviewDTO> {
  return previewFromContext(itemId, await loadPreviewContext(tx as Tx, itemId, 'draft'), policiesInput);
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
            where: { status: ProcessLaborClaimStatus.ACTIVE, standardLaborMilliseconds: { gt: 0 } },
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
    const laborUnitsPerProduct = completion.reportQuantityBasis === 'action' ? 1 : standard.unitsPerProduct;
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
      unitsPerProduct: laborUnitsPerProduct,
    });
    let claimedQty = 0;
    let claimedLabor = 0n;
    const replacementLaborByClaim = redistributeStandardLaborByExistingShares({
      totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
      existingStandardLaborMilliseconds: pool.claims.map(claim => claim.standardLaborMilliseconds),
    });
    for (const [claimIndex, claim] of pool.claims.entries()) {
      const replacementLabor = replacementLaborByClaim[claimIndex];
      claimedQty += claim.quantity;
      claimedLabor += replacementLabor;
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
          standardLaborMilliseconds: replacementLabor,
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
        unitsPerProduct: laborUnitsPerProduct,
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
    policies: Record<string, ProductTimeInsertPolicy>;
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
      reportingPolicy: profile.reportingPolicy,
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
  let systemCoveredQty = 0;
  let actualRequiredQty = 0;
  const fulfillmentModes = new Set<string>();
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
      const synchronized = await tx.workOrderProcessStep.updateMany({
        where: {
          id: existing.id,
          quantityVersion: existing.quantityVersion,
        },
        data: {
          processDefinitionId: entry.processDefinitionId,
          processCode: entry.processDefinition.code,
          processName: entry.processDefinition.name,
          stageGroup: entry.processDefinition.stageGroup,
          position: entry.position,
          sequenceGroup: entry.sequenceGroup,
          ...productTimeStandardSnapshot(profile, entry),
          // Quantity reporting is a ledger contract, not merely a display
          // preference. Once facts exist, keep the original reporting basis so
          // historical quantities and labor claims never change units.
          ...(stepHasFacts(existing) ? {
            reportQuantityBasis: existing.reportQuantityBasis,
            reportUnitLabel: existing.reportUnitLabel,
          } : {}),
          // A later publication that does not change this step's standard must
          // preserve the durable deployment marker that originally introduced
          // or changed it. Pure ordering changes do not claim a time change.
          productTimeDeploymentRouteId: changedTime ? input.deploymentRouteId : undefined,
          remark: entry.remark,
          quantityVersion: { increment: 1 },
        },
      });
      if (synchronized.count !== 1) {
        throw new ProductTimeDeploymentError(
          `工单 ${route.workOrder.code} 的 ${existing.processName} 数量已变化，请刷新后重试发布`,
          409,
          'PRODUCT_TIME_STEP_QUANTITY_CONFLICT',
        );
      }
      // The same transaction may later redirect this unchanged step's input to
      // a newly inserted upstream group. Keep the in-memory optimistic version
      // aligned with the metadata update above so that redirectSequentialInput
      // detects real concurrent quantity changes instead of conflicting with
      // this deployment's own version increment.
      existing.quantityVersion += 1;
      continue;
    }

    const targetQty = getProductionQuantitySummary(route.workOrder).targetQty || 0;
    if (targetQty <= 0) {
      throw new ProductTimeDeploymentError(
        `工单 ${route.workOrder.code} 缺少有效生产数量，不能计算新增工序的历史承接边界`,
        409,
        'PRODUCT_TIME_SUPPLEMENT_QUANTITY_REQUIRED',
      );
    }
    const insertDiff = input.diffs.find(diff => (
      diff.kind === 'insert' && diff.occurrenceKey === entry.occurrenceKey
    ));
    const insertPolicy = insertDiff?.policy
      || input.policies[entry.occurrenceKey]
      || (!entry.isCritical ? 'AUTO_BY_PROGRESS' : null);
    if (!insertPolicy) {
      throw new ProductTimeDeploymentError(
        `${entry.processDefinition.name} 缺少新增工序生效策略，请重新预览`,
        409,
        'CRITICAL_PROCESS_POLICY_REQUIRED',
      );
    }
    const boundary = coverageBoundaryForEntry(
      route,
      profile,
      previous,
      entry,
      currentByKey,
      targetQty,
    );
    if (boundary.conflict) {
      throw new ProductTimeDeploymentError(
        boundary.conflict.message,
        409,
        boundary.conflict.code,
      );
    }
    const projection = projectProductTimeCoverage({
      routeTargetQty: targetQty,
      routeHasFacts: facts,
      routeCompleted: routeState(route) === 'completed',
      hasNextExistingStep: boundary.hasNextExistingStep,
      downstreamHasFacts: boundary.downstreamHasFacts,
      boundaryProgressQty: boundary.boundaryProgressQty,
      policy: insertPolicy,
    });
    const nextExistingEntry = profile.entries.find(candidate => (
      candidate.position > entry.position
      && currentByKey.has(candidate.occurrenceKey)
    ));
    const mustSupplement = projection.execution === 'supplement';
    const standard = productTimeStandardSnapshot(profile, entry);
    const targetStep = nextExistingEntry ? currentByKey.get(nextExistingEntry.occurrenceKey) || null : null;
    const fulfilledSupplement = mustSupplement && projection.obligationStatus === 'FULFILLED';
    const futureOnly = projection.fulfillmentMode === 'FUTURE_ONLY';
    const now = new Date();
    const supplementRemark = futureOnly
      ? `产品工序与工时 V${profile.version} 新增关键工序；该已开工/历史路线仅保留“未来生效”审计，不生成报工`
      : projection.actualRequiredQty === 0
        ? `产品工序与工时 V${profile.version} 新增工序；系统历史承接 ${projection.systemCoveredQty}，不生成员工报工或工时`
        : projection.systemCoveredQty > 0
          ? `产品工序与工时 V${profile.version} 新增工序；系统历史承接 ${projection.systemCoveredQty}，剩余 ${projection.actualRequiredQty} 待实际报工；不参与数量释放`
          : projection.fulfillmentMode === 'RECALL_REQUIRED'
            ? `产品工序与工时 V${profile.version} 新增关键工序；${projection.actualRequiredQty} 待召回返工报工；不参与数量释放`
            : `产品工序与工时 V${profile.version} 新增补充报工义务 ${projection.actualRequiredQty}；不参与数量释放`;
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
        status: mustSupplement
          ? futureOnly
            ? 'skipped'
            : fulfilledSupplement
              ? 'completed'
              : 'current'
          : 'pending',
        startedAt: mustSupplement && !fulfilledSupplement ? now : null,
        completedAt: fulfilledSupplement ? now : null,
        completedById: null,
        remark: mustSupplement
          ? [entry.remark, supplementRemark].filter(Boolean).join('；')
          : entry.remark || `产品工序与工时 V${profile.version} 新增工序`,
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
      const obligation = await tx.processSupplementObligation.create({
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
          requiredQty: projection.obligationRequiredQty,
          systemCoveredQty: projection.systemCoveredQty,
          reportedQty: 0,
          reportedUnitQty: 0,
          reportedGoodUnitQty: 0,
          reportedDefectUnitQty: 0,
          reportQuantityBasis: standard.reportQuantityBasis,
          reportUnitLabel: standard.reportUnitLabel,
          status: projection.obligationStatus === 'FULFILLED'
            ? ProcessSupplementObligationStatus.FULFILLED
            : ProcessSupplementObligationStatus.ACTIVE,
          fulfillmentMode: projection.fulfillmentMode as ProcessSupplementFulfillmentMode,
          // This legacy field is the physical quantity-release contract and is
          // intentionally fixed to NONE. The product-time application policy
          // is stored separately in ProcessSupplementCoverage.policy.
          releasePolicy: 'NONE',
          isCritical: entry.isCritical,
          timeBasis: standard.timeBasis as string,
          unitLabel: standard.unitLabel || '件',
          standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit as number,
          setupMilliseconds: standard.setupMilliseconds,
          unitsPerProduct: standard.unitsPerProduct,
          countsForEfficiency: standard.countsForEfficiency,
          fulfilledAt: projection.obligationStatus === 'FULFILLED' ? now : null,
        },
      });
      await tx.processSupplementCoverage.create({
        data: {
          obligationId: obligation.id,
          deploymentRouteId: input.deploymentRouteId,
          workOrderId: route.workOrderId,
          routeId: route.id,
          displayStepId: step.id,
          policy: projection.policy,
          fulfillmentMode: projection.fulfillmentMode as ProcessSupplementFulfillmentMode,
          routeTargetQty: projection.routeTargetQty,
          systemCoveredQty: projection.systemCoveredQty,
          actualRequiredQty: projection.actualRequiredQty,
          evidence: {
            source: 'product_time_deployment',
            deploymentId: input.deploymentId,
            profileId: profile.id,
            profileVersion: profile.version,
            occurrenceKey: entry.occurrenceKey,
            routeState: routeState(route),
            routeHadFacts: facts,
            boundary: boundary.evidence,
            projection,
          } as Prisma.InputJsonValue,
          actorId: input.actorId,
        },
      });
      supplements += 1;
      reopened = reopened || projection.shouldReopenCompletedRoute;
    }
    systemCoveredQty += projection.systemCoveredQty;
    actualRequiredQty += projection.actualRequiredQty;
    fulfillmentModes.add(projection.fulfillmentMode);
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
    systemCoveredQty,
    actualRequiredQty,
    fulfillmentModes: [...fulfillmentModes],
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
        systemCoveredQty: Number(result.systemCoveredQty || 0),
        actualRequiredQty: Number(result.actualRequiredQty || 0),
        fulfillmentModes: Array.isArray(result.fulfillmentModes)
          ? result.fulfillmentModes.map(String)
          : [],
        error: route.error,
      };
    }),
  };
}

export type PublishedProductTimeRouteDeploymentSummary = {
  deploymentId: string;
  updated: number;
  routeCount: number;
  activeUpdated: number;
  partiallyUpdated: number;
  insertedProcesses: number;
  movedProcesses: number;
  updatedTimes: number;
  historicalReports: number;
  affectedEmployees: number;
  supplementObligations: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  reopenedRoutes: number;
  reviewRequired: number;
};

function summarizePublishedRouteDeployment(
  deployment: ProductTimeDeploymentDTO,
): PublishedProductTimeRouteDeploymentSummary {
  return deployment.routes.reduce<PublishedProductTimeRouteDeploymentSummary>((summary, route) => {
    const supplementObligations = route.supplementObligations || 0;
    summary.updated += route.status === 'succeeded' ? 1 : 0;
    summary.routeCount += 1;
    summary.activeUpdated += route.state === 'unstarted' ? 0 : 1;
    summary.partiallyUpdated += supplementObligations > 0 ? 1 : 0;
    summary.insertedProcesses += route.insertedProcesses || 0;
    summary.movedProcesses += route.movedProcesses || 0;
    summary.updatedTimes += route.updatedTimes || 0;
    summary.historicalReports += route.historicalReports || 0;
    summary.affectedEmployees += route.affectedEmployees || 0;
    summary.supplementObligations += supplementObligations;
    summary.systemCoveredQty += route.systemCoveredQty || 0;
    summary.actualRequiredQty += route.actualRequiredQty || 0;
    summary.reviewRequired += supplementObligations > 0 ? 1 : 0;
    return summary;
  }, {
    deploymentId: deployment.id,
    updated: 0,
    routeCount: 0,
    activeUpdated: 0,
    partiallyUpdated: 0,
    insertedProcesses: 0,
    movedProcesses: 0,
    updatedTimes: 0,
    historicalReports: 0,
    affectedEmployees: 0,
    supplementObligations: 0,
    systemCoveredQty: 0,
    actualRequiredQty: 0,
    reopenedRoutes: 0,
    reviewRequired: 0,
  });
}

/**
 * Deploy an already-published employee route-change profile to every peer work
 * order inside the caller's transaction. The source route is handled by the
 * route-change service itself and can be excluded. Using the full deployment
 * engine here is important: routes with production facts receive a real
 * supplemental obligation and coverage ledger instead of a metadata-only
 * profile-version bump.
 */
export async function deployPublishedProductTimeRoutesInTransaction(
  tx: Tx,
  input: {
    itemId: string;
    profileId: string;
    actorId: string;
    sourceChangeId: string;
    excludeRouteId?: string;
  },
): Promise<PublishedProductTimeRouteDeploymentSummary> {
  const context = await loadPreviewContext(tx, input.itemId, 'published');
  if (context.profile.id !== input.profileId) {
    throw new ProductTimeDeploymentError(
      '员工工艺变更生成的正式版本已被其他版本替代，请重新启用',
      409,
      'PRODUCT_TIME_PUBLISHED_PROFILE_CONFLICT',
    );
  }
  const scopedContext = {
    ...context,
    routes: input.excludeRouteId
      ? context.routes.filter(route => route.id !== input.excludeRouteId)
      : context.routes,
  };
  const preview = previewFromContext(input.itemId, scopedContext, {});
  if (!preview.canPublish) {
    const firstConflict = preview.conflicts[0];
    throw new ProductTimeDeploymentError(
      firstConflict
        ? `同产品工单同步被阻断：${firstConflict.message}`
        : '同产品工单存在阻断冲突，不能启用员工工艺变更',
      409,
      'PRODUCT_TIME_DEPLOYMENT_BLOCKED',
    );
  }

  const existing = await tx.productTimeDeployment.findUnique({
    where: { profileId: context.profile.id },
    include: deploymentInclude,
  });
  if (existing?.status === ProductTimeDeploymentStatus.ACTIVE) {
    return summarizePublishedRouteDeployment(serializeDeployment(existing));
  }
  if (existing) {
    throw new ProductTimeDeploymentError(
      '员工工艺变更版本存在未完成的同步记录，请先处理后重试',
      409,
      'PRODUCT_TIME_DEPLOYMENT_EXISTS',
    );
  }

  const deployment = await tx.productTimeDeployment.create({
    data: {
      drawingLibraryItemId: input.itemId,
      profileId: context.profile.id,
      baseProfileId: context.previous?.id || null,
      profileVersion: context.profile.version,
      expectedRevision: context.profile.revision,
      previewToken: preview.previewToken,
      idempotencyKey: `product-time-route-change:${input.sourceChangeId}:${context.profile.id}`,
      status: ProductTimeDeploymentStatus.APPLYING,
      impact: preview.impact as unknown as Prisma.InputJsonValue,
      diffs: preview.diffs as unknown as Prisma.InputJsonValue,
      conflicts: preview.conflicts as unknown as Prisma.InputJsonValue,
      actorId: input.actorId,
      startedAt: new Date(),
    },
  });
  const summary: PublishedProductTimeRouteDeploymentSummary = {
    deploymentId: deployment.id,
    updated: 0,
    routeCount: scopedContext.routes.length,
    activeUpdated: 0,
    partiallyUpdated: 0,
    insertedProcesses: 0,
    movedProcesses: 0,
    updatedTimes: 0,
    historicalReports: 0,
    affectedEmployees: 0,
    supplementObligations: 0,
    systemCoveredQty: 0,
    actualRequiredQty: 0,
    reopenedRoutes: 0,
    reviewRequired: 0,
  };
  for (const route of scopedContext.routes) {
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
      policies: {},
    });
    await tx.productTimeDeploymentRoute.update({
      where: { id: ledger.id },
      data: {
        status: ProductTimeDeploymentRouteStatus.SUCCEEDED,
        routeVersionAfter: applied.routeVersionAfter,
        result: applied.result as unknown as Prisma.InputJsonValue,
      },
    });
    summary.updated += 1;
    summary.activeUpdated += routeState(route) === 'unstarted' ? 0 : 1;
    summary.partiallyUpdated += applied.result.supplementObligations > 0 ? 1 : 0;
    summary.insertedProcesses += applied.result.insertedProcesses;
    summary.movedProcesses += applied.result.movedProcesses;
    summary.updatedTimes += applied.result.updatedTimes;
    summary.historicalReports += applied.result.historicalReports;
    summary.affectedEmployees += applied.result.affectedEmployees;
    summary.supplementObligations += applied.result.supplementObligations;
    summary.systemCoveredQty += applied.result.systemCoveredQty;
    summary.actualRequiredQty += applied.result.actualRequiredQty;
    summary.reopenedRoutes += applied.result.reopened ? 1 : 0;
    summary.reviewRequired += applied.result.supplementObligations > 0 ? 1 : 0;
  }
  await tx.productTimeDeployment.update({
    where: { id: deployment.id },
    data: { status: ProductTimeDeploymentStatus.ACTIVE, completedAt: new Date() },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: 'deploy_process_route_change_product_time_to_peer_orders',
      targetType: 'product_time_deployment',
      targetId: deployment.id,
      detail: {
        drawingLibraryItemId: input.itemId,
        profileId: context.profile.id,
        profileVersion: context.profile.version,
        sourceChangeId: input.sourceChangeId,
        excludedSourceRouteId: input.excludeRouteId || null,
        ...summary,
      },
    },
  });
  return summary;
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
  policies?: unknown;
}): Promise<{ profileId: string; deployment: ProductTimeDeploymentDTO }> {
  const policies = normalizeProductTimeInsertPolicies(input.policies);
  let outside: ProductTimeDeploymentPreviewDTO;
  try {
    outside = await previewProductTimeDeployment(input.itemId, prisma, policies);
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
          const currentPreview = previewFromContext(input.itemId, context, policies);
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
              policies,
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
      diffs: true,
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
    const policies = Object.fromEntries(
      jsonArray<ProductTimeDeploymentDiffDTO>(failed.diffs)
        .filter(diff => diff.kind === 'insert' && diff.policy)
        .map(diff => [diff.occurrenceKey, diff.policy]),
    );
    return reconcilePublishedProductTimeDeployment({
      itemId: failed.drawingLibraryItemId,
      actorId: input.actorId,
      policies,
    });
  }
  // A failed all-or-nothing transaction applied zero routes. The optional UI
  // subset is therefore intentionally advisory: retry always revalidates and
  // reruns the complete product scope so no route is silently omitted.
  const policies = Object.fromEntries(
    jsonArray<ProductTimeDeploymentDiffDTO>(failed.diffs)
      .filter(diff => diff.kind === 'insert' && diff.policy)
      .map(diff => [diff.occurrenceKey, diff.policy]),
  );
  const preview = await previewProductTimeDeployment(failed.drawingLibraryItemId, prisma, policies);
  const result = await publishProductTimeDeployment({
    itemId: failed.drawingLibraryItemId,
    actorId: input.actorId,
    expectedRevision: failed.expectedRevision,
    previewToken: preview.previewToken,
    policies,
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
  policies?: unknown;
}): Promise<ProductTimeDeploymentDTO> {
  const policies = normalizeProductTimeInsertPolicies(input.policies);
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
    const preview = previewFromContext(input.itemId, context, policies);
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
        policies,
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
