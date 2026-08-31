import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { reconcileDraftProductTimeRoutes } from '@/lib/process-routing';
import { reconcileProductionCarryovers } from '@/lib/production-carryovers';
import {
  materializeProductQualityWarningForWorkOrder,
  type ProductQualityWarningProjectionStatus,
} from '@/lib/internal-quality-risks';
import {
  automaticProductionPlanReleaseTarget,
  automaticallyReleaseProductionPlanBatch,
  chinaWeekRange,
  productionPlanTargetWeek,
  reconcileAutomaticallyReleasedProductionPlanBatch,
  reconcileFutureActiveProductionPlanWeeks,
  reconcileLegacyDeletedPlanQuantities,
} from '@/lib/production-planning';

export type ProductionPlanningMaintenancePhaseName =
  | 'automatic_release'
  | 'future_week_alignment'
  | 'current_week_carryover'
  | 'draft_product_time_routes'
  | 'drawing_links'
  | 'legacy_deleted_quantities'
  | 'automatic_start_finalize'
  | 'quality_warning_projection';

export type ProductionPlanningMaintenancePhaseStatus =
  | 'completed'
  | 'partial'
  | 'skipped_locked'
  | 'failed';

export type ProductionPlanningMaintenancePhaseResult = {
  phase: ProductionPlanningMaintenancePhaseName;
  status: ProductionPlanningMaintenancePhaseStatus;
  durationMs: number;
  result?: unknown;
  errorCode?: string;
  failedItemIds?: string[];
};

export type ProductionPlanningMaintenanceResult = {
  ok: boolean;
  code: 'PRODUCTION_PLANNING_MAINTENANCE_COMPLETED' | 'PRODUCTION_PLANNING_MAINTENANCE_PARTIAL';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  phases: ProductionPlanningMaintenancePhaseResult[];
};

type PhaseExecution = Omit<ProductionPlanningMaintenancePhaseResult, 'phase' | 'durationMs'>;
type PhaseDefinition = {
  phase: ProductionPlanningMaintenancePhaseName;
  execute: () => Promise<PhaseExecution>;
};

type ProductionPlanningAuxiliaryPhase = Exclude<ProductionPlanningMaintenancePhaseName, 'automatic_release'>;
const ROTATING_AUXILIARY_PHASES: ProductionPlanningAuxiliaryPhase[] = [
  'future_week_alignment',
  'current_week_carryover',
  'draft_product_time_routes',
  'drawing_links',
  'legacy_deleted_quantities',
];
const ON_EVERY_POLL_PHASES: ProductionPlanningAuxiliaryPhase[] = [
  'automatic_start_finalize',
  'quality_warning_projection',
];
const ALL_AUXILIARY_PHASES = [...ROTATING_AUXILIARY_PHASES, ...ON_EVERY_POLL_PHASES];
let auxiliaryPhaseCursor = 0;
let automaticFinalizeCursor: string | null = null;
let automaticReleaseActiveCursor: string | null = null;
let automaticReleasePreparationCursor: string | null = null;
let automaticReleasePrefer: 'active' | 'preparation' = 'active';
let qualityProjectionReportCursor: string | null = null;
let qualityProjectionWorkOrderCursor: string | null = null;

function nextAuxiliaryPhase(): ProductionPlanningAuxiliaryPhase {
  const phase = ROTATING_AUXILIARY_PHASES[auxiliaryPhaseCursor % ROTATING_AUXILIARY_PHASES.length];
  auxiliaryPhaseCursor = (auxiliaryPhaseCursor + 1) % ROTATING_AUXILIARY_PHASES.length;
  return phase;
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  if (typeof candidate?.code === 'string' && candidate.code) return candidate.code;
  if (typeof candidate?.meta?.code === 'string' && candidate.meta.code) return candidate.meta.code;
  if (error instanceof Error && /timeout|timed out|P2028|57014/i.test(error.message)) {
    return 'PRODUCTION_MAINTENANCE_TIMEOUT';
  }
  return 'PRODUCTION_MAINTENANCE_PHASE_FAILED';
}

async function tryLockedTransaction<T>(input: {
  lockKey: string;
  execute: (tx: Prisma.TransactionClient) => Promise<T>;
  maxWaitMs?: number;
  statementTimeoutMs?: number;
  transactionTimeoutMs?: number;
}): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const maxWaitMs = input.maxWaitMs ?? 250;
  const statementTimeoutMs = input.statementTimeoutMs ?? 4_000;
  const transactionTimeoutMs = input.transactionTimeoutMs ?? statementTimeoutMs + 500;
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${input.lockKey})) AS acquired
    `;
    if (!rows[0]?.acquired) return { acquired: false as const };
    await tx.$queryRaw`
      SELECT
        set_config('lock_timeout', ${`${Math.min(1_000, statementTimeoutMs)}ms`}, true),
        set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)
    `;
    return { acquired: true as const, value: await input.execute(tx) };
  }, { maxWait: maxWaitMs, timeout: transactionTimeoutMs });
}

/**
 * Execute independent maintenance phases without allowing one bad record or
 * one timed-out phase to suppress the remaining work. This is intentionally
 * exported so the failure-isolation contract can be unit-tested without a DB.
 */
export async function executeProductionPlanningMaintenancePhases(
  definitions: PhaseDefinition[],
): Promise<ProductionPlanningMaintenancePhaseResult[]> {
  const results: ProductionPlanningMaintenancePhaseResult[] = [];
  for (const definition of definitions) {
    const startedAt = performance.now();
    try {
      const result = await definition.execute();
      results.push({
        phase: definition.phase,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        ...result,
      });
    } catch (error) {
      const result: ProductionPlanningMaintenancePhaseResult = {
        phase: definition.phase,
        status: 'failed',
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        errorCode: errorCode(error),
      };
      results.push(result);
      console.error('production planning maintenance phase failed', {
        phase: definition.phase,
        errorCode: result.errorCode,
        error,
      });
    }
  }
  return results;
}

type AutomaticReleaseCandidate = {
  id: string;
  weekStartDate: Date;
  releaseState: string;
  workOrderId: string | null;
};

export function selectFairAutomaticReleaseCandidates(input: {
  active: readonly AutomaticReleaseCandidate[];
  preparation: readonly AutomaticReleaseCandidate[];
  limit: number;
  prefer: 'active' | 'preparation';
}): { candidates: AutomaticReleaseCandidate[]; nextPrefer: 'active' | 'preparation' } {
  const limit = Math.max(1, Math.min(5, input.limit));
  const pools = {
    active: [...input.active],
    preparation: [...input.preparation],
  };
  const order: Array<'active' | 'preparation'> = input.prefer === 'active'
    ? ['active', 'preparation']
    : ['preparation', 'active'];
  const candidates: AutomaticReleaseCandidate[] = [];
  while (candidates.length < limit && (pools.active.length || pools.preparation.length)) {
    let advanced = false;
    for (const target of order) {
      const candidate = pools[target].shift();
      if (!candidate) continue;
      candidates.push(candidate);
      advanced = true;
      if (candidates.length >= limit) break;
    }
    if (!advanced) break;
  }
  return {
    candidates,
    nextPrefer: input.prefer === 'active' ? 'preparation' : 'active',
  };
}

export function nextAutomaticReleaseCursor(input: {
  current: string | null;
  scanned: readonly AutomaticReleaseCandidate[];
  eligible: readonly AutomaticReleaseCandidate[];
  selected: readonly AutomaticReleaseCandidate[];
}): string | null {
  if (input.selected.length) return input.selected.at(-1)!.id;
  // An eligible item not selected because the other week won this bounded turn
  // must remain at the head of this pool for the next cycle.
  if (input.eligible.length) return input.current;
  if (input.scanned.length) return input.scanned.at(-1)!.id;
  return null;
}

async function runAutomaticReleasePhase(now: Date, limit: number): Promise<PhaseExecution> {
  const currentWeek = productionPlanTargetWeek('active', now);
  const nextWeek = productionPlanTargetWeek('preparation', now);
  const scan = await tryLockedTransaction({
    lockKey: 'production-plan-auto-release-scan',
    maxWaitMs: 100,
    statementTimeoutMs: 750,
    transactionTimeoutMs: 1_200,
    execute: tx => Promise.all([
      tx.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        ...(automaticReleaseActiveCursor ? { id: { gt: automaticReleaseActiveCursor } } : {}),
        planOrder: { deletedAt: null, status: { notIn: ['paused', 'cancelled'] } },
        weekStartDate: { gte: currentWeek.start, lt: addUtcDays(currentWeek.start, 1) },
        OR: [
          { releaseState: { in: ['draft', 'preparation'] } },
          { releaseState: 'active', workOrderId: null },
        ],
      },
      select: { id: true, weekStartDate: true, releaseState: true, workOrderId: true },
      orderBy: { id: 'asc' },
      take: Math.max(limit + 1, 3),
      }),
      tx.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        ...(automaticReleasePreparationCursor ? { id: { gt: automaticReleasePreparationCursor } } : {}),
        planOrder: { deletedAt: null, status: { notIn: ['paused', 'cancelled'] } },
        weekStartDate: { gte: nextWeek.start, lt: addUtcDays(nextWeek.start, 1) },
        OR: [
          { releaseState: 'draft' },
          { releaseState: 'preparation', workOrderId: null },
        ],
      },
      select: { id: true, weekStartDate: true, releaseState: true, workOrderId: true },
      orderBy: { id: 'asc' },
      take: Math.max(limit + 1, 3),
      }),
    ]),
  });
  if (!scan.acquired) {
    return { status: 'skipped_locked', result: { reason: 'another_worker_scanning' } };
  }
  const [currentCandidates, nextCandidates] = scan.value;
  const activeEligible = currentCandidates.filter(batch => automaticProductionPlanReleaseTarget(batch, now) === 'active');
  const preparationEligible = nextCandidates.filter(batch => automaticProductionPlanReleaseTarget(batch, now) === 'preparation');
  const selection = selectFairAutomaticReleaseCandidates({
    active: activeEligible,
    preparation: preparationEligible,
    limit,
    prefer: automaticReleasePrefer,
  });
  automaticReleasePrefer = selection.nextPrefer;
  const candidates = selection.candidates;
  const selectedActive = candidates.filter(batch => automaticProductionPlanReleaseTarget(batch, now) === 'active');
  const selectedPreparation = candidates.filter(batch => automaticProductionPlanReleaseTarget(batch, now) === 'preparation');
  automaticReleaseActiveCursor = nextAutomaticReleaseCursor({
    current: automaticReleaseActiveCursor,
    scanned: currentCandidates,
    eligible: activeEligible,
    selected: selectedActive,
  });
  automaticReleasePreparationCursor = nextAutomaticReleaseCursor({
    current: automaticReleasePreparationCursor,
    scanned: nextCandidates,
    eligible: preparationEligible,
    selected: selectedPreparation,
  });
  let active = 0;
  let preparation = 0;
  let started = 0;
  let warningCount = 0;
  let skippedLocked = 0;
  const failedItemIds: string[] = [];
  for (const batch of candidates) {
    try {
      const locked = await tryLockedTransaction({
        // Preserve the domain's global serialization while using try-lock so
        // duplicate workers never wait behind one another.
        lockKey: 'production-plan-auto-release',
        statementTimeoutMs: 2_000,
        transactionTimeoutMs: 2_500,
        execute: tx => automaticallyReleaseProductionPlanBatch(tx, {
          batchId: batch.id,
          actorId: null,
          now,
          trigger: 'automatic_reconciliation',
        }),
      });
      if (!locked.acquired) {
        skippedLocked += 1;
        continue;
      }
      const released = locked.value;
      if (!released) continue;
      if (released.target === 'active') active += 1;
      else preparation += 1;
      warningCount += released.warnings.length;
      if (released.started) started += 1;
    } catch (error) {
      failedItemIds.push(batch.id);
      console.error('production planning maintenance batch failed', {
        phase: 'automatic_release',
        batchId: batch.id,
        errorCode: errorCode(error),
        error,
      });
    }
  }
  return {
    status: failedItemIds.length ? 'partial' : skippedLocked === candidates.length && candidates.length ? 'skipped_locked' : 'completed',
    result: {
      candidateCount: candidates.length,
      activeCursor: automaticReleaseActiveCursor,
      preparationCursor: automaticReleasePreparationCursor,
      nextPrefer: automaticReleasePrefer,
      active,
      preparation,
      started,
      warningCount,
      skippedLocked,
      failedCount: failedItemIds.length,
    },
    ...(failedItemIds.length ? { errorCode: 'PRODUCTION_MAINTENANCE_BATCH_PARTIAL', failedItemIds } : {}),
  };
}

async function runAutomaticFinalizePhase(now: Date, limit = 2): Promise<PhaseExecution> {
  const boundedLimit = Math.max(1, Math.min(2, limit));
  const currentWeek = productionPlanTargetWeek('active', now);
  const scan = await tryLockedTransaction({
    lockKey: 'production-plan-auto-finalize-scan',
    maxWaitMs: 100,
    statementTimeoutMs: 750,
    transactionTimeoutMs: 1_200,
    execute: tx => tx.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        id: automaticFinalizeCursor ? { gt: automaticFinalizeCursor } : undefined,
        releaseState: 'active',
        workOrderId: { not: null },
        weekStartDate: { gte: currentWeek.start, lt: addUtcDays(currentWeek.start, 1) },
        planOrder: { deletedAt: null, status: { notIn: ['paused', 'cancelled'] } },
        workOrder: { is: { deletedAt: null, startedAt: null, completedAt: null } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: boundedLimit,
    }),
  });
  if (!scan.acquired) {
    return { status: 'skipped_locked', result: { reason: 'another_worker_scanning' } };
  }
  let candidates = scan.value;
  if (!candidates.length && automaticFinalizeCursor) {
    automaticFinalizeCursor = null;
    return { status: 'completed', result: { candidateCount: 0, cursorWrapped: true } };
  }
  const failedItemIds: string[] = [];
  let reconciled = 0;
  let started = 0;
  let skippedLocked = 0;
  for (const batch of candidates) {
    automaticFinalizeCursor = batch.id;
    try {
      const locked = await tryLockedTransaction({
        lockKey: 'production-plan-auto-release',
        maxWaitMs: 150,
        statementTimeoutMs: 2_000,
        transactionTimeoutMs: 2_500,
        execute: tx => reconcileAutomaticallyReleasedProductionPlanBatch(tx, {
          batchId: batch.id,
          actorId: null,
          now,
        }),
      });
      if (!locked.acquired) {
        skippedLocked += 1;
        continue;
      }
      if (locked.value?.reconciled) reconciled += 1;
      if (locked.value?.started) started += 1;
    } catch (error) {
      failedItemIds.push(batch.id);
      console.error('production planning maintenance batch failed', {
        phase: 'automatic_start_finalize',
        batchId: batch.id,
        errorCode: errorCode(error),
        error,
      });
    }
  }
  return {
    status: failedItemIds.length ? 'partial' : skippedLocked === candidates.length && candidates.length ? 'skipped_locked' : 'completed',
    result: {
      candidateCount: candidates.length,
      reconciled,
      started,
      skippedLocked,
      failedCount: failedItemIds.length,
    },
    ...(failedItemIds.length ? { errorCode: 'PRODUCTION_MAINTENANCE_BATCH_PARTIAL', failedItemIds } : {}),
  };
}

export type ProductQualityWarningProjectionCandidate = {
  reportId: string;
  workOrderId: string;
};

/**
 * Run a bounded set of idempotent projection pairs. Exported for a behavior
 * test that proves one bad pair does not suppress later candidates and that the
 * per-cycle cap is enforced independently of database state.
 */
export async function executeBoundedQualityWarningProjection(input: {
  candidates: readonly ProductQualityWarningProjectionCandidate[];
  limit?: number;
  project: (candidate: ProductQualityWarningProjectionCandidate) => Promise<ProductQualityWarningProjectionStatus>;
}): Promise<PhaseExecution> {
  const limit = Math.max(1, Math.min(4, input.limit ?? 2));
  const candidates = input.candidates.slice(0, limit);
  let created = 0;
  let existing = 0;
  let ineligible = 0;
  let skippedLocked = 0;
  const failedItemIds: string[] = [];
  for (const candidate of candidates) {
    const itemId = `${candidate.reportId}:${candidate.workOrderId}`;
    try {
      const status = await input.project(candidate);
      if (status === 'created') created += 1;
      else if (status === 'existing') existing += 1;
      else if (status === 'ineligible') ineligible += 1;
      else skippedLocked += 1;
    } catch (error) {
      failedItemIds.push(itemId);
      console.error('production planning maintenance quality warning projection failed', {
        phase: 'quality_warning_projection',
        itemId,
        errorCode: errorCode(error),
        error,
      });
    }
  }
  return {
    status: failedItemIds.length
      ? 'partial'
      : skippedLocked === candidates.length && candidates.length
        ? 'skipped_locked'
        : 'completed',
    result: {
      candidateCount: candidates.length,
      created,
      existing,
      ineligible,
      skippedLocked,
      failedCount: failedItemIds.length,
    },
    ...(failedItemIds.length
      ? { errorCode: 'QUALITY_WARNING_PROJECTION_PARTIAL', failedItemIds }
      : {}),
  };
}

async function runQualityWarningProjectionPhase(now: Date, limit = 2): Promise<PhaseExecution> {
  const boundedLimit = Math.max(1, Math.min(4, limit));
  // The scan transaction ends before any projection pair starts its own short
  // transaction. This explicitly prevents nested transactions and keeps the
  // maintenance lock away from planning/execution reads.
  const scan = await tryLockedTransaction({
    lockKey: 'quality-warning-projection-scan',
    maxWaitMs: 100,
    statementTimeoutMs: 750,
    transactionTimeoutMs: 1_200,
    execute: async tx => {
      const report = await tx.internalQualityRiskReport.findFirst({
        where: {
          deletedAt: null,
          warningState: 'ACTIVE',
          currentRevisionId: { not: null },
          ...(qualityProjectionReportCursor ? { id: { gt: qualityProjectionReportCursor } } : {}),
          currentRevision: { is: { published: true, products: { some: {} } } },
          AND: [
            { OR: [{ warningRevokedAt: null }, { warningRevokedAt: { gt: now } }] },
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
            { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] },
          ],
        },
        select: {
          id: true,
          currentRevisionId: true,
          currentRevision: {
            select: { products: { select: { drawingLibraryItemId: true } } },
          },
        },
        orderBy: { id: 'asc' },
      });
      if (!report?.currentRevisionId || !report.currentRevision) {
        return { reportId: null, workOrderIds: [] as string[], hasMore: false };
      }
      const productIds = [...new Set(report.currentRevision.products.map(link => link.drawingLibraryItemId))];
      const workOrders = productIds.length
        ? await tx.workOrder.findMany({
            where: {
              deletedAt: null,
              drawingLibraryItemId: { in: productIds },
              ...(qualityProjectionWorkOrderCursor ? { id: { gt: qualityProjectionWorkOrderCursor } } : {}),
              qualityRiskAlerts: { none: { revisionId: report.currentRevisionId } },
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: boundedLimit + 1,
          })
        : [];
      return {
        reportId: report.id,
        workOrderIds: workOrders.slice(0, boundedLimit).map(order => order.id),
        hasMore: workOrders.length > boundedLimit,
      };
    },
  });
  if (!scan.acquired) {
    return { status: 'skipped_locked', result: { reason: 'another_worker_scanning' } };
  }
  if (!scan.value.reportId) {
    const cursorWrapped = Boolean(qualityProjectionReportCursor || qualityProjectionWorkOrderCursor);
    qualityProjectionReportCursor = null;
    qualityProjectionWorkOrderCursor = null;
    return { status: 'completed', result: { candidateCount: 0, cursorWrapped } };
  }
  if (!scan.value.workOrderIds.length) {
    qualityProjectionReportCursor = scan.value.reportId;
    qualityProjectionWorkOrderCursor = null;
    return { status: 'completed', result: { candidateCount: 0, reportComplete: true } };
  }

  const candidates = scan.value.workOrderIds.map(workOrderId => ({
    reportId: scan.value.reportId!,
    workOrderId,
  }));
  // Move the cursor even when a pair fails. Failed pairs are retried after the
  // bounded scan wraps, while a permanently bad item cannot starve all others.
  qualityProjectionWorkOrderCursor = scan.value.workOrderIds.at(-1) || null;
  if (!scan.value.hasMore) {
    qualityProjectionReportCursor = scan.value.reportId;
    qualityProjectionWorkOrderCursor = null;
  }
  return executeBoundedQualityWarningProjection({
    candidates,
    limit: boundedLimit,
    project: candidate => materializeProductQualityWarningForWorkOrder({
      ...candidate,
      now,
      transactionTimeoutMs: 2_000,
    }),
  });
}

function lockedAuxiliaryPhase(
  phase: Exclude<ProductionPlanningMaintenancePhaseName, 'automatic_release'>,
  now: Date,
): PhaseDefinition {
  const execute = async (): Promise<PhaseExecution> => {
    const locked = await tryLockedTransaction<unknown>({
      lockKey: `production-planning-maintenance:${phase}`,
      statementTimeoutMs: 3_500,
      transactionTimeoutMs: 4_000,
      execute: tx => {
        switch (phase) {
          case 'future_week_alignment':
            return reconcileFutureActiveProductionPlanWeeks(tx, { actorId: null, now });
          case 'current_week_carryover':
            return reconcileProductionCarryovers(tx, {
              targetWeekStart: chinaWeekRange(now).start,
              actorId: null,
            });
          case 'draft_product_time_routes':
            return reconcileDraftProductTimeRoutes(tx, { actorId: null });
          case 'drawing_links':
            return reconcileProductionPlanDrawingLinks(tx);
          case 'legacy_deleted_quantities':
            return reconcileLegacyDeletedPlanQuantities(tx, { actorId: null, now });
          case 'automatic_start_finalize':
            throw new Error('AUTOMATIC_FINALIZE_USES_BATCH_RUNNER');
          case 'quality_warning_projection':
            throw new Error('QUALITY_WARNING_PROJECTION_USES_PAIR_RUNNER');
        }
      },
    });
    return locked.acquired
      ? { status: 'completed', result: locked.value }
      : { status: 'skipped_locked', result: { reason: 'another_worker_active' } };
  };
  return { phase, execute };
}

export async function runProductionPlanningMaintenanceCycle(input: {
  now?: Date;
  automaticReleaseLimit?: number;
  auxiliaryPhase?: ProductionPlanningAuxiliaryPhase;
  includeAutomaticRelease?: boolean;
} = {}): Promise<ProductionPlanningMaintenanceResult> {
  const started = new Date();
  const startedAt = performance.now();
  const now = input.now || started;
  const automaticReleaseLimit = Math.max(1, Math.min(5, input.automaticReleaseLimit ?? 2));
  const auxiliaryPhase = input.auxiliaryPhase || nextAuxiliaryPhase();
  const auxiliaryDefinition = auxiliaryPhase === 'automatic_start_finalize'
    ? { phase: auxiliaryPhase, execute: () => runAutomaticFinalizePhase(now, automaticReleaseLimit) }
    : auxiliaryPhase === 'quality_warning_projection'
      ? { phase: auxiliaryPhase, execute: () => runQualityWarningProjectionPhase(now, automaticReleaseLimit) }
      : lockedAuxiliaryPhase(auxiliaryPhase, now);
  const phases = await executeProductionPlanningMaintenancePhases([
    ...(input.includeAutomaticRelease === false
      ? []
      : [{
          phase: 'automatic_release' as const,
          execute: () => runAutomaticReleasePhase(now, automaticReleaseLimit),
        }]),
    auxiliaryDefinition,
  ]);
  const ok = phases.every(phase => phase.status === 'completed' || phase.status === 'skipped_locked');
  return {
    ok,
    code: ok
      ? 'PRODUCTION_PLANNING_MAINTENANCE_COMPLETED'
      : 'PRODUCTION_PLANNING_MAINTENANCE_PARTIAL',
    startedAt: started.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    phases,
  };
}

export function isProductionPlanningAuxiliaryPhase(
  value: string | null,
): value is ProductionPlanningAuxiliaryPhase {
  return Boolean(value && ALL_AUXILIARY_PHASES.includes(value as ProductionPlanningAuxiliaryPhase));
}
