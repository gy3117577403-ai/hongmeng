import { Prisma } from '@prisma/client';
import type {
  ProcessRouteStatus,
  ProcessStageGroup,
  ProcessStepStatus,
  ProcessTemplateDTO,
  ProcessTemplateStepDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';
import {
  productTimeProfileInclude,
  productTimeStandardSnapshot,
  type ProductTimeProfileRecord,
} from '@/lib/product-time';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { legacyStatusForStage, normalizeWorkOrderStage } from '@/lib/work-orders';

export const PROCESS_STAGE_GROUPS: ProcessStageGroup[] = ['frontend', 'backend', 'finish'];
export const PROCESS_ROUTE_STATUSES: ProcessRouteStatus[] = ['draft', 'confirmed', 'in_progress', 'completed'];
export const PROCESS_STEP_STATUSES: ProcessStepStatus[] = ['pending', 'current', 'completed', 'skipped'];
export const PRODUCT_TIME_PENDING_ROUTE_SOURCE = 'product_time_pending';
export const PRODUCT_TIME_PENDING_ROUTE_NAME = '产品工序与工时待发布';

export class ProductTimeRouteLinkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 409, code = 'PRODUCT_TIME_ROUTE_LINK_FAILED') {
    super(message);
    this.name = 'ProductTimeRouteLinkError';
    this.status = status;
    this.code = code;
  }
}

export const processStageGroupText: Record<ProcessStageGroup, string> = {
  frontend: '前端工序',
  backend: '后端工序',
  finish: '完工工序',
};

export const processRouteStatusText: Record<ProcessRouteStatus, string> = {
  draft: '待确认',
  confirmed: '已确认',
  in_progress: '生产中',
  completed: '已完成',
};

export const processStepStatusText: Record<ProcessStepStatus, string> = {
  pending: '待开始',
  current: '当前工序',
  completed: '已完成',
  skipped: '已跳过',
};

export const PROCESS_SHORTCUT_GROUPS: Array<{
  key: string;
  name: string;
  processCodes: string[];
}> = [
  { key: 'crimp', name: '压接组', processCodes: ['crimping', 'crimp_inspection'] },
  { key: 'solder', name: '焊接组', processCodes: ['soldering', 'solder_inspection'] },
  { key: 'heat-shrink', name: '热缩组', processCodes: ['heat_shrink_tube', 'positioning', 'heat_shrink'] },
  { key: 'inspection', name: '检验组', processCodes: ['continuity_test', 'inspection'] },
];

export const processTemplateInclude = Prisma.validator<Prisma.ProcessTemplateInclude>()({
  createdBy: { select: { id: true, username: true, displayName: true } },
  steps: {
    orderBy: { position: 'asc' },
  },
});

export const processRouteInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  confirmedBy: { select: { id: true, username: true, displayName: true } },
  steps: {
    orderBy: { position: 'asc' },
    include: {
      completedBy: { select: { id: true, username: true, displayName: true } },
      executions: {
        where: { voidedAt: null },
        select: { goodQty: true },
      },
      completions: {
        where: { voidedAt: null },
        select: { processedQty: true, goodQty: true, defectQty: true },
      },
      _count: { select: { executions: true, completions: true } },
    },
  },
  activities: {
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: { actor: { select: { id: true, username: true, displayName: true } } },
  },
});

export const processRouteSummaryInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  steps: {
    orderBy: { position: 'asc' },
    include: {
      executions: {
        where: { voidedAt: null },
        select: { goodQty: true },
      },
      completions: {
        where: { voidedAt: null },
        select: { processedQty: true, goodQty: true, defectQty: true },
      },
      _count: { select: { executions: true, completions: true } },
    },
  },
});

export type ProcessTemplateRecord = Prisma.ProcessTemplateGetPayload<{
  include: typeof processTemplateInclude;
}>;

export type ProcessRouteRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof processRouteInclude;
}>;

export type ProcessRouteSummaryRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof processRouteSummaryInclude;
}>;

type DraftRouteReplacementCheck = {
  status: string;
  routeSource?: string | null;
  startedAt: Date | string | null;
  steps: Array<{
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    inputQty: number;
    processedQty: number;
    goodOutputQty: number;
    defectOutputQty: number;
    releasedGoodQty: number;
    _count: { executions: number; completions: number };
  }>;
};

type WorkOrderRouteMaterializationCheck = {
  stage?: string | null;
  status?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  lastProgressAt?: Date | string | null;
  progress?: number | null;
  completedQty?: unknown;
  uncompletedQty?: unknown;
  productionTargetQty?: unknown;
  frontendTransferredQty?: number | null;
  branchType?: unknown;
  planActive?: boolean;
  planClearedAt?: Date | string | null;
};

type HistoricalProductTimeRouteRepairCheck = {
  workOrder: WorkOrderRouteMaterializationCheck;
  route: DraftRouteReplacementCheck | null;
};

const draftRouteSyncInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  workOrder: {
    select: {
      id: true,
      stage: true,
      status: true,
      specification: true,
      drawingLibraryItemId: true,
      uncompletedQty: true,
      productionTargetQty: true,
    },
  },
  steps: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      processDefinitionId: true,
      processCode: true,
      processName: true,
      stageGroup: true,
      position: true,
      sequenceGroup: true,
      standardTimeId: true,
      standardVersion: true,
      productTimeProfileId: true,
      productTimeEntryId: true,
      productTimeProfileVersion: true,
      standardSource: true,
      timeBasis: true,
      unitLabel: true,
      standardMillisecondsPerUnit: true,
      setupMilliseconds: true,
      unitsPerProduct: true,
      countsForEfficiency: true,
      status: true,
      startedAt: true,
      completedAt: true,
      inputQty: true,
      processedQty: true,
      goodOutputQty: true,
      defectOutputQty: true,
      releasedGoodQty: true,
      remark: true,
      _count: {
        select: {
          executions: true,
          completions: true,
          dailyProcessTasks: true,
          processLaborPools: true,
          sourceQuantityMovements: true,
          targetQuantityMovements: true,
        },
      },
    },
  },
});

type DraftRouteSyncRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof draftRouteSyncInclude;
}>;

export type ProcessStepInput = {
  processDefinitionId?: unknown;
  processCode?: unknown;
  processName?: unknown;
  stageGroup?: unknown;
  unitsPerProduct?: unknown;
  sequenceGroup?: unknown;
};

export type ValidatedProcessStep = {
  processDefinitionId: string | null;
  processCode: string;
  processName: string;
  stageGroup: ProcessStageGroup;
  position: number;
  unitsPerProduct: number;
  sequenceGroup: number;
};

export type ProcessStepValidationResult =
  | { ok: true; steps: ValidatedProcessStep[] }
  | { ok: false; error: string };

export type CompletedProcessGroupTransition = {
  groupCompleted: boolean;
  nextSequenceGroup: number | null;
  nextStepIds: string[];
  activeStepIds: string[];
  routeCompleted: boolean;
};

export function resolveCompletedProcessGroupTransition(
  steps: Array<{ id: string; sequenceGroup: number; status: string }>,
  completedStepId: string,
): CompletedProcessGroupTransition {
  const completedStep = steps.find(step => step.id === completedStepId);
  if (!completedStep) throw new Error('当前工序不存在');

  const unfinishedParallelSteps = steps.filter(step => (
    step.id !== completedStepId
    && step.sequenceGroup === completedStep.sequenceGroup
    && step.status !== 'completed'
    && step.status !== 'skipped'
  ));
  if (unfinishedParallelSteps.length > 0) {
    return {
      groupCompleted: false,
      nextSequenceGroup: null,
      nextStepIds: [],
      activeStepIds: unfinishedParallelSteps.map(step => step.id),
      routeCompleted: false,
    };
  }

  const futurePendingSteps = steps.filter(step => (
    step.sequenceGroup > completedStep.sequenceGroup && step.status === 'pending'
  ));
  const nextSequenceGroup = futurePendingSteps.length
    ? Math.min(...futurePendingSteps.map(step => step.sequenceGroup))
    : null;
  const nextStepIds = nextSequenceGroup === null
    ? []
    : futurePendingSteps
        .filter(step => step.sequenceGroup === nextSequenceGroup)
        .map(step => step.id);
  return {
    groupCompleted: true,
    nextSequenceGroup,
    nextStepIds,
    activeStepIds: nextStepIds,
    routeCompleted: nextStepIds.length === 0,
  };
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeRouteStatus(value: string): ProcessRouteStatus {
  return PROCESS_ROUTE_STATUSES.includes(value as ProcessRouteStatus)
    ? value as ProcessRouteStatus
    : 'draft';
}

function normalizeStepStatus(value: string): ProcessStepStatus {
  return PROCESS_STEP_STATUSES.includes(value as ProcessStepStatus)
    ? value as ProcessStepStatus
    : 'pending';
}

export function normalizeProcessStageGroup(value: unknown): ProcessStageGroup | null {
  const normalized = cleanText(value, 30) as ProcessStageGroup;
  return PROCESS_STAGE_GROUPS.includes(normalized) ? normalized : null;
}

export function processStageForGroup(stageGroup: ProcessStageGroup): 'frontend' | 'backend' {
  return stageGroup === 'frontend' ? 'frontend' : 'backend';
}

export function initialProcessRouteStatus(routeSource: string): ProcessRouteStatus {
  return routeSource === 'product_time_profile' ? 'confirmed' : 'draft';
}

export function canReplaceDraftRouteWithProductTime(route: DraftRouteReplacementCheck): boolean {
  return route.status === 'draft'
    && !route.startedAt
    && route.steps.every(step => (
      step.status === 'pending'
      && !step.startedAt
      && !step.completedAt
      && step._count.executions === 0
      && step._count.completions === 0
    ));
}

const AUTO_UPGRADE_PRODUCT_TIME_ROUTE_SOURCES = [
  'product_time_profile',
  PRODUCT_TIME_PENDING_ROUTE_SOURCE,
] as const;

export function canUpgradeUnstartedConfirmedProductTimeRoute(
  route: DraftRouteReplacementCheck,
): boolean {
  return route.status === 'confirmed'
    && AUTO_UPGRADE_PRODUCT_TIME_ROUTE_SOURCES.includes(
      route.routeSource as typeof AUTO_UPGRADE_PRODUCT_TIME_ROUTE_SOURCES[number],
    )
    && !route.startedAt
    && route.steps.length > 0
    && route.steps.every(step => (
      step.status === 'pending'
      && !step.startedAt
      && !step.completedAt
      && step._count.executions === 0
      && step._count.completions === 0
      && Number(step.processedQty || 0) === 0
      && Number(step.goodOutputQty || 0) === 0
      && Number(step.defectOutputQty || 0) === 0
      && Number(step.releasedGoodQty || 0) === 0
  ));
}

/**
 * A route may already be marked as started because production release opens the
 * first process automatically.  That timestamp is not a production fact by
 * itself.  When no quantity, execution, completion, or downstream release has
 * been recorded, the published product-time route can still be upgraded safely.
 */
export function canSynchronizeStartedFactFreeProductTimeRoute(
  route: DraftRouteReplacementCheck,
): boolean {
  return route.status === 'in_progress'
    && route.routeSource === 'product_time_profile'
    && Boolean(route.startedAt)
    && route.steps.length > 0
    && route.steps.every(step => (
      (step.status === 'current' || step.status === 'pending')
      && !step.completedAt
      && step._count.executions === 0
      && step._count.completions === 0
      && Number(step.processedQty || 0) === 0
      && Number(step.goodOutputQty || 0) === 0
      && Number(step.defectOutputQty || 0) === 0
      && Number(step.releasedGoodQty || 0) === 0
    ));
}

export function canMaterializeProductTimeRouteForWorkOrder(
  workOrder: WorkOrderRouteMaterializationCheck,
): boolean {
  const stage = normalizeWorkOrderStage(workOrder.stage || workOrder.status) || 'not_issued';
  const quantity = getProductionQuantitySummary(workOrder);
  return stage === 'not_issued'
    && !workOrder.planClearedAt
    && !workOrder.branchType
    && !workOrder.startedAt
    && !workOrder.completedAt
    && !workOrder.lastProgressAt
    && Number(workOrder.progress || 0) === 0
    && Number(workOrder.frontendTransferredQty || 0) === 0
    && quantity.completedQty === 0;
}

export function canRepairHistoricalProductTimeRoute({
  workOrder,
  route,
}: HistoricalProductTimeRouteRepairCheck): boolean {
  const stage = normalizeWorkOrderStage(workOrder.stage || workOrder.status) || 'not_issued';
  const quantity = getProductionQuantitySummary(workOrder);
  const hasLegacyProductionFacts = stage === 'frontend'
    || stage === 'backend'
    || Boolean(workOrder.startedAt)
    || Boolean(workOrder.lastProgressAt)
    || Number(workOrder.progress || 0) > 0
    || Number(quantity.completedQty || 0) > 0
    || Number(workOrder.frontendTransferredQty || 0) > 0;
  if (
    stage === 'completed'
    || workOrder.completedAt
    || workOrder.planActive === false
    || workOrder.planClearedAt
    || workOrder.branchType
    || !hasLegacyProductionFacts
  ) return false;
  if (!route) return true;
  if (route.routeSource !== PRODUCT_TIME_PENDING_ROUTE_SOURCE) return false;
  return route.steps.every(step => (
    step._count.executions === 0
    && step._count.completions === 0
    && Number(step.inputQty || 0) === 0
    && Number(step.processedQty || 0) === 0
    && Number(step.goodOutputQty || 0) === 0
    && Number(step.defectOutputQty || 0) === 0
    && Number(step.releasedGoodQty || 0) === 0
  ));
}

export function canResetLegacyDraftRouteToProductTimePending(
  route: DraftRouteReplacementCheck,
  stageValue: unknown,
  statusValue?: unknown,
): boolean {
  const stage = normalizeWorkOrderStage(stageValue) || normalizeWorkOrderStage(statusValue) || 'not_issued';
  return stage === 'not_issued' && canReplaceDraftRouteWithProductTime(route);
}

export function productTimeRouteActivation(
  stageValue: unknown,
  statusValue?: unknown,
): { status: 'confirmed' | 'in_progress'; shouldStart: boolean } | null {
  const stage = normalizeWorkOrderStage(stageValue || statusValue) || 'not_issued';
  if (stage === 'backend' || stage === 'completed') return null;
  return stage === 'frontend'
    ? { status: 'in_progress', shouldStart: true }
    : { status: 'confirmed', shouldStart: false };
}

export function validateProcessSteps(input: unknown): ProcessStepValidationResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: '工艺路线至少需要一个工序' };
  }
  if (input.length > 40) {
    return { ok: false, error: '单条工艺路线最多支持 40 个工序' };
  }

  const steps: ValidatedProcessStep[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index] as ProcessStepInput;
    const processName = cleanText(item?.processName, 60);
    const stageGroup = normalizeProcessStageGroup(item?.stageGroup);
    const unitsPerProduct = Number(item?.unitsPerProduct ?? 1);
    const sequenceGroup = Number(item?.sequenceGroup ?? index + 1);
    let processCode = cleanText(item?.processCode, 80)
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!processName) return { ok: false, error: `第 ${index + 1} 个工序缺少名称` };
    if (!stageGroup) return { ok: false, error: `第 ${index + 1} 个工序的阶段分组不正确` };
    if (!Number.isInteger(unitsPerProduct) || unitsPerProduct <= 0 || unitsPerProduct > 10_000) {
      return { ok: false, error: `第 ${index + 1} 个工序的每件次数必须是 1-10000 的整数` };
    }
    if (!Number.isInteger(sequenceGroup) || sequenceGroup <= 0 || sequenceGroup > 80) {
      return { ok: false, error: `第 ${index + 1} 个工序的顺序组不正确` };
    }
    if (!processCode) processCode = `custom-${index + 1}-${Date.now()}`;
    if (codes.has(processCode)) {
      return { ok: false, error: `工序“${processName}”重复，请删除重复项后再保存` };
    }
    codes.add(processCode);
    steps.push({
      processDefinitionId: cleanText(item?.processDefinitionId, 80) || null,
      processCode,
      processName,
      stageGroup,
      position: index + 1,
      unitsPerProduct,
      sequenceGroup,
    });
  }
  return { ok: true, steps };
}

export function serializeProcessTemplate(template: ProcessTemplateRecord): ProcessTemplateDTO {
  return {
    id: template.id,
    templateKey: template.templateKey,
    name: template.name,
    version: template.version,
    isDefault: template.isDefault,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy,
    steps: template.steps.map(step => ({
      id: step.id,
      processDefinitionId: step.processDefinitionId,
      processCode: step.processCode,
      processName: step.processName,
      stageGroup: normalizeProcessStageGroup(step.stageGroup) || 'frontend',
      position: step.position,
      unitsPerProduct: step.unitsPerProduct,
    })),
  };
}

export function serializeProcessRoute(
  route: ProcessRouteRecord | ProcessRouteSummaryRecord,
): WorkOrderProcessRouteDTO {
  const status = normalizeRouteStatus(route.status);
  const steps = route.steps.map(step => {
    const executionGoodQuantity = 'executions' in step
      ? step.executions.reduce((total, execution) => total + execution.goodQty, 0)
      : 0;
    const completionProcessedQuantity = 'completions' in step
      ? step.completions.reduce((total, completion) => total + completion.processedQty, 0)
      : 0;
    const completionGoodQuantity = 'completions' in step
      ? step.completions.reduce((total, completion) => total + completion.goodQty, 0)
      : 0;
    const completionDefectQuantity = 'completions' in step
      ? step.completions.reduce((total, completion) => total + completion.defectQty, 0)
      : 0;
    const reportedGoodQuantity = executionGoodQuantity + completionGoodQuantity;
    return {
      id: step.id,
      processDefinitionId: step.processDefinitionId,
      processCode: step.processCode,
      processName: step.processName,
      stageGroup: normalizeProcessStageGroup(step.stageGroup) || 'frontend',
      position: step.position,
      sequenceGroup: step.sequenceGroup,
      unitsPerProduct: step.unitsPerProduct,
      status: normalizeStepStatus(step.status),
      startedAt: step.startedAt?.toISOString() || null,
      completedAt: step.completedAt?.toISOString() || null,
      completedBy: 'completedBy' in step ? step.completedBy : null,
      remark: step.remark,
      standardTimeId: step.standardTimeId,
      standardVersion: step.standardVersion,
      timeBasis: step.timeBasis === 'per_batch'
        ? 'per_batch' as const
        : step.timeBasis === 'per_unit'
          ? 'per_unit' as const
          : null,
      unitLabel: step.unitLabel,
      standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
      setupMilliseconds: step.setupMilliseconds,
      countsForEfficiency: step.countsForEfficiency,
      inputQty: step.inputQty,
      processedQty: step.processedQty,
      goodOutputQty: step.goodOutputQty,
      defectOutputQty: step.defectOutputQty,
      releasedGoodQty: step.releasedGoodQty,
      quantityVersion: step.quantityVersion,
      executionCount: '_count' in step ? step._count.executions : 0,
      completionCount: '_count' in step ? step._count.completions : 0,
      completedProcessedQuantity: completionProcessedQuantity,
      completedGoodQuantity: completionGoodQuantity,
      completedDefectQuantity: completionDefectQuantity,
      reportedGoodQuantity,
      remainingGoodQuantity: null,
      productTimeProfileId: step.productTimeProfileId,
      productTimeEntryId: step.productTimeEntryId,
      productTimeProfileVersion: step.productTimeProfileVersion,
      standardSource: step.standardSource,
    };
  });
  const completedStepCount = steps.filter(step => step.status === 'completed' || step.status === 'skipped').length;
  const currentSteps = steps.filter(step => step.status === 'current');
  const currentSequenceGroup = currentSteps.length
    ? Math.min(...currentSteps.map(step => step.sequenceGroup))
    : null;
  const pendingGroups = steps
    .filter(step => step.status === 'pending' && (currentSequenceGroup === null || step.sequenceGroup > currentSequenceGroup))
    .map(step => step.sequenceGroup);
  const nextSequenceGroup = pendingGroups.length ? Math.min(...pendingGroups) : null;
  const nextSteps = nextSequenceGroup === null
    ? []
    : steps.filter(step => step.status === 'pending' && step.sequenceGroup === nextSequenceGroup);
  const currentStep = currentSteps[0] || null;
  const nextStep = nextSteps[0] || null;
  const detailRoute = route as ProcessRouteRecord;
  return {
    id: route.id,
    workOrderId: route.workOrderId,
    templateId: route.templateId,
    templateName: route.templateName,
    templateVersion: route.templateVersion,
    status,
    statusText: status === 'draft' && route.routeSource === PRODUCT_TIME_PENDING_ROUTE_SOURCE
      ? '产品工序待发布'
      : processRouteStatusText[status],
    version: route.version,
    confirmedAt: route.confirmedAt?.toISOString() || null,
    confirmedBy: 'confirmedBy' in route ? route.confirmedBy : null,
    startedAt: route.startedAt?.toISOString() || null,
    completedAt: route.completedAt?.toISOString() || null,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
    stepCount: steps.length,
    completedStepCount,
    progress: steps.length > 0 ? Math.round((completedStepCount / steps.length) * 100) : 0,
    currentSteps,
    nextSteps,
    currentStep,
    nextStep,
    steps,
    activities: Array.isArray(detailRoute.activities)
      ? detailRoute.activities.map(activity => ({
          id: activity.id,
          stepId: activity.stepId,
          action: activity.action,
          content: activity.content,
          actor: activity.actor,
          createdAt: activity.createdAt.toISOString(),
        }))
      : undefined,
    productTimeProfileId: route.productTimeProfileId,
    productTimeProfileVersion: route.productTimeProfileVersion,
    routeSource: route.routeSource,
  };
}

export async function findDefaultProcessTemplate(
  tx: Prisma.TransactionClient,
): Promise<ProcessTemplateRecord | null> {
  return tx.processTemplate.findFirst({
    where: { isDefault: true, isActive: true },
    include: processTemplateInclude,
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
}

function productTimeRouteSteps(profile: ProductTimeProfileRecord, currentStartedAt?: Date, initialInputQty = 0) {
  const firstSequenceGroup = profile.entries[0]?.sequenceGroup;
  return profile.entries.map(entry => ({
    processDefinitionId: entry.processDefinitionId,
    processCode: entry.processDefinition.code,
    processName: entry.processDefinition.name,
    stageGroup: entry.processDefinition.stageGroup,
    position: entry.position,
    sequenceGroup: entry.sequenceGroup,
    ...productTimeStandardSnapshot(profile, entry),
    inputQty: entry.sequenceGroup === firstSequenceGroup ? initialInputQty : 0,
    status: currentStartedAt && entry.sequenceGroup === firstSequenceGroup ? 'current' : 'pending',
    startedAt: currentStartedAt && entry.sequenceGroup === firstSequenceGroup ? currentStartedAt : null,
  }));
}

async function applyPublishedProductTimeToUnstartedRoute(
  tx: Prisma.TransactionClient,
  input: {
    route: DraftRouteSyncRecord;
    profile: ProductTimeProfileRecord;
    actorId?: string | null;
    activityContent: string;
  },
): Promise<{ updated: boolean; started: boolean }> {
  const replacesDraft = canReplaceDraftRouteWithProductTime(input.route);
  const upgradesConfirmed = canUpgradeUnstartedConfirmedProductTimeRoute(input.route);
  if (!replacesDraft && !upgradesConfirmed) return { updated: false, started: false };
  const activation = productTimeRouteActivation(input.route.workOrder.stage, input.route.workOrder.status);
  const firstDefinition = input.profile.entries[0]?.processDefinition;
  if (!activation || !firstDefinition) return { updated: false, started: false };

  const now = new Date();
  const shouldStart = activation.shouldStart;
  const routeAlreadyMatches = upgradesConfirmed
    && !shouldStart
    && input.route.productTimeProfileId === input.profile.id
    && input.route.productTimeProfileVersion === input.profile.version
    && input.route.templateVersion === input.profile.version
    && input.route.steps.length === input.profile.entries.length
    && input.profile.entries.every(entry => {
      const step = input.route.steps.find(candidate => candidate.processDefinitionId === entry.processDefinitionId);
      return step ? productTimeStepSnapshotMatches(step, input.profile, entry, true) : false;
    });
  if (routeAlreadyMatches) return { updated: false, started: false };
  const initialInputQty = getProductionQuantitySummary(input.route.workOrder).targetQty || 0;
  const firstSequenceGroup = input.profile.entries[0].sequenceGroup;
  const firstGroupEntries = input.profile.entries.filter(entry => entry.sequenceGroup === firstSequenceGroup);
  const routeLock: Prisma.WorkOrderProcessRouteWhereInput = upgradesConfirmed
    ? {
        id: input.route.id,
        version: input.route.version,
        status: 'confirmed',
        startedAt: null,
        routeSource: { in: [...AUTO_UPGRADE_PRODUCT_TIME_ROUTE_SOURCES] },
        steps: {
          some: {},
          every: {
            status: 'pending',
            startedAt: null,
            completedAt: null,
            processedQty: 0,
            goodOutputQty: 0,
            defectOutputQty: 0,
            releasedGoodQty: 0,
            executions: { none: {} },
            completions: { none: {} },
          },
        },
      }
    : {
        id: input.route.id,
        version: input.route.version,
        status: 'draft',
      };
  const update = await tx.workOrderProcessRoute.updateMany({
    where: routeLock,
    data: {
      templateId: null,
      templateName: `${input.route.workOrder.specification || '当前产品'} 产品工时`,
      templateVersion: input.profile.version,
      productTimeProfileId: input.profile.id,
      productTimeProfileVersion: input.profile.version,
      routeSource: 'product_time_profile',
      status: activation.status,
      confirmedAt: now,
      confirmedById: input.actorId || null,
      startedAt: shouldStart ? now : null,
      version: { increment: 1 },
    },
  });
  if (update.count !== 1) return { updated: false, started: false };

  await tx.workOrderProcessStep.deleteMany({ where: { routeId: input.route.id } });
  await tx.workOrderProcessStep.createMany({
    data: productTimeRouteSteps(input.profile, shouldStart ? now : undefined, initialInputQty).map(step => ({
      routeId: input.route.id,
      ...step,
    })),
  });
  await tx.processRouteActivity.create({
    data: {
      routeId: input.route.id,
      action: 'sync_product_time_route',
      content: input.activityContent,
      actorId: input.actorId || null,
      detail: {
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
      },
    },
  });
  if (shouldStart) {
    const firstStage = processStageForGroup(normalizeProcessStageGroup(firstDefinition.stageGroup) || 'frontend');
    await tx.workOrder.update({
      where: { id: input.route.workOrderId },
      data: {
        stage: firstStage,
        status: legacyStatusForStage(firstStage),
        latestProgressRemark: `当前工序：${firstGroupEntries.map(entry => entry.processDefinition.name).join('、')}`,
      },
    });
  }
  await tx.operationLog.create({
    data: {
      userId: input.actorId || null,
      action: 'sync_product_time_route',
      targetType: 'work_order_process_route',
      targetId: input.route.id,
      detail: {
        workOrderId: input.route.workOrderId,
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
        automaticallyStarted: shouldStart,
      },
    },
  });
  return { updated: true, started: shouldStart };
}

async function resetLegacyDraftRouteToProductTimePending(
  tx: Prisma.TransactionClient,
  route: DraftRouteSyncRecord,
  actorId?: string | null,
): Promise<boolean> {
  if (
    route.routeSource !== 'process_template'
    || !canResetLegacyDraftRouteToProductTimePending(route, route.workOrder.stage, route.workOrder.status)
  ) return false;
  const update = await tx.workOrderProcessRoute.updateMany({
    where: {
      id: route.id,
      version: route.version,
      status: 'draft',
      routeSource: 'process_template',
    },
    data: {
      templateId: null,
      templateName: PRODUCT_TIME_PENDING_ROUTE_NAME,
      templateVersion: 0,
      productTimeProfileId: null,
      productTimeProfileVersion: null,
      routeSource: PRODUCT_TIME_PENDING_ROUTE_SOURCE,
      confirmedAt: null,
      confirmedById: null,
      startedAt: null,
      completedAt: null,
      version: { increment: 1 },
    },
  });
  if (update.count !== 1) return false;

  await tx.workOrderProcessStep.deleteMany({ where: { routeId: route.id } });
  await tx.processRouteActivity.create({
    data: {
      routeId: route.id,
      action: 'await_product_time_route',
      content: '已停止沿用旧工艺模板，等待发布当前产品的工序与工时',
      actorId: actorId || null,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: actorId || null,
      action: 'await_product_time_route',
      targetType: 'work_order_process_route',
      targetId: route.id,
      detail: { workOrderId: route.workOrderId, previousRouteSource: route.routeSource },
    },
  });
  return true;
}

export async function reconcileDraftProductTimeRoutes(
  tx: Prisma.TransactionClient,
  input: {
    workOrderWhere?: Prisma.WorkOrderWhereInput;
    actorId?: string | null;
  } = {},
): Promise<{ updated: number; applied: number; pending: number; started: number; skipped: number }> {
  const routes = await tx.workOrderProcessRoute.findMany({
    where: {
      status: 'draft',
      routeSource: { in: ['process_template', PRODUCT_TIME_PENDING_ROUTE_SOURCE] },
      ...(input.workOrderWhere ? { workOrder: input.workOrderWhere } : {}),
    },
    include: draftRouteSyncInclude,
  });
  const drawingLibraryItemIds = [...new Set(routes
    .map(route => route.workOrder.drawingLibraryItemId)
    .filter((id): id is string => Boolean(id)))];
  const profiles = drawingLibraryItemIds.length
    ? await tx.productTimeProfile.findMany({
        where: { drawingLibraryItemId: { in: drawingLibraryItemIds }, status: 'published' },
        include: productTimeProfileInclude,
        orderBy: [{ drawingLibraryItemId: 'asc' }, { version: 'desc' }],
      })
    : [];
  const profileByItem = new Map<string, ProductTimeProfileRecord>();
  for (const profile of profiles) {
    if (profile.entries.length && !profileByItem.has(profile.drawingLibraryItemId)) {
      profileByItem.set(profile.drawingLibraryItemId, profile);
    }
  }

  let applied = 0;
  let pending = 0;
  let started = 0;
  let skipped = 0;
  for (const route of routes) {
    if (!canReplaceDraftRouteWithProductTime(route)) {
      skipped += 1;
      continue;
    }
    const profile = route.workOrder.drawingLibraryItemId
      ? profileByItem.get(route.workOrder.drawingLibraryItemId)
      : undefined;
    if (profile) {
      const result = await applyPublishedProductTimeToUnstartedRoute(tx, {
        route,
        profile,
        actorId: input.actorId,
        activityContent: `自动应用产品工序与工时 V${profile.version}，替换旧模板或待发布占位`,
      });
      if (result.updated) {
        applied += 1;
        if (result.started) started += 1;
      } else skipped += 1;
      continue;
    }
    if (await resetLegacyDraftRouteToProductTimePending(tx, route, input.actorId)) pending += 1;
    else skipped += 1;
  }
  return { updated: applied + pending, applied, pending, started, skipped };
}

export async function createWorkOrderProcessRoute(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    actorId?: string | null;
  },
): Promise<{ created: boolean; routeId: string }> {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: input.workOrderId },
    select: {
      id: true,
      drawingLibraryItemId: true,
      specification: true,
      stage: true,
      status: true,
      uncompletedQty: true,
      productionTargetQty: true,
    },
  });
  if (!workOrder) throw new Error('WORK_ORDER_NOT_FOUND');
  const foundProductProfile = workOrder.drawingLibraryItemId
    ? await tx.productTimeProfile.findFirst({
        where: { drawingLibraryItemId: workOrder.drawingLibraryItemId, status: 'published' },
        include: productTimeProfileInclude,
        orderBy: { version: 'desc' },
      })
    : null;
  const productProfile = foundProductProfile?.entries.length ? foundProductProfile : null;
  const existing = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: input.workOrderId },
    include: draftRouteSyncInclude,
  });
  if (existing) {
    if (
      productProfile
      && (
        canReplaceDraftRouteWithProductTime(existing)
        || canUpgradeUnstartedConfirmedProductTimeRoute(existing)
      )
    ) {
      await applyPublishedProductTimeToUnstartedRoute(tx, {
        route: existing,
        profile: productProfile,
        actorId: input.actorId,
        activityContent: `自动应用产品工序与工时 V${productProfile.version}，替换旧模板或待发布占位`,
      });
    } else if (!productProfile) {
      await resetLegacyDraftRouteToProductTimePending(tx, existing, input.actorId);
    }
    return { created: false, routeId: existing.id };
  }

  const activation = productProfile
    ? productTimeRouteActivation(workOrder.stage, workOrder.status)
    : null;
  const shouldStart = Boolean(activation?.shouldStart && productProfile?.entries.length);
  const autoConfirmed = Boolean(productProfile);
  const initialStatus = productProfile ? activation?.status || 'confirmed' : 'draft';
  const confirmedAt = autoConfirmed ? new Date() : null;
  const initialInputQty = getProductionQuantitySummary(workOrder).targetQty || 0;

  const route = await tx.workOrderProcessRoute.create({
    data: {
      workOrderId: input.workOrderId,
      templateId: null,
      templateName: productProfile ? `${workOrder.specification || '当前产品'} 产品工时` : PRODUCT_TIME_PENDING_ROUTE_NAME,
      templateVersion: productProfile?.version || 0,
      productTimeProfileId: productProfile?.id || null,
      productTimeProfileVersion: productProfile?.version || null,
      routeSource: productProfile ? 'product_time_profile' : PRODUCT_TIME_PENDING_ROUTE_SOURCE,
      status: initialStatus,
      confirmedAt,
      confirmedById: autoConfirmed ? input.actorId || null : null,
      startedAt: shouldStart ? confirmedAt : null,
      ...(productProfile ? {
        steps: { create: productTimeRouteSteps(productProfile, shouldStart && confirmedAt ? confirmedAt : undefined, initialInputQty) },
      } : {}),
      activities: {
        create: {
          action: 'create_process_route',
          content: productProfile
            ? `已从产品工序与工时 V${productProfile.version} 自动生成并确认，共 ${productProfile.entries.length} 道工序`
            : '等待维护并发布当前产品的工序与工时',
          actorId: input.actorId || null,
          detail: productProfile
            ? { productTimeProfileId: productProfile.id, productTimeProfileVersion: productProfile.version }
            : { routeSource: PRODUCT_TIME_PENDING_ROUTE_SOURCE },
        },
      },
    },
    select: { id: true },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId || null,
      action: 'create_process_route',
      targetType: 'work_order_process_route',
      targetId: route.id,
      detail: {
        workOrderId: input.workOrderId,
        productTimeProfileId: productProfile?.id || null,
        productTimeProfileVersion: productProfile?.version || null,
        routeSource: productProfile ? 'product_time_profile' : PRODUCT_TIME_PENDING_ROUTE_SOURCE,
        autoConfirmed,
      },
    },
  });
  return { created: true, routeId: route.id };
}

export async function applyPublishedProductTimeToWorkOrder(
  tx: Prisma.TransactionClient,
  input: { workOrderId: string; actorId?: string | null },
): Promise<{
  routeId: string;
  action: 'created' | 'updated' | 'already_applied';
  productTimeProfileVersion: number;
  processCount: number;
}> {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: input.workOrderId },
    select: {
      id: true,
      deletedAt: true,
      drawingLibraryItemId: true,
      stage: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastProgressAt: true,
      progress: true,
      completedQty: true,
      uncompletedQty: true,
      productionTargetQty: true,
      frontendTransferredQty: true,
      branchType: true,
      planActive: true,
      planClearedAt: true,
    },
  });
  if (!workOrder || workOrder.deletedAt) {
    throw new ProductTimeRouteLinkError('工单不存在或已经删除', 404, 'WORK_ORDER_NOT_FOUND');
  }
  if (!workOrder.drawingLibraryItemId) {
    throw new ProductTimeRouteLinkError(
      '当前工单尚未关联图纸资料产品，请先完成产品匹配',
      409,
      'PRODUCT_TIME_ITEM_MISSING',
    );
  }

  const profile = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: workOrder.drawingLibraryItemId, status: 'published' },
    include: productTimeProfileInclude,
    orderBy: { version: 'desc' },
  });
  if (!profile?.entries.length) {
    throw new ProductTimeRouteLinkError(
      '当前产品没有已发布工序与工时，请先完成配置并发布',
      409,
      'PRODUCT_TIME_PROFILE_MISSING',
    );
  }

  const existing = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: workOrder.id },
    include: draftRouteSyncInclude,
  });
  if (
    existing
    && existing.routeSource === 'product_time_profile'
    && existing.productTimeProfileVersion === profile.version
    && existing.steps.length > 0
  ) {
    return {
      routeId: existing.id,
      action: 'already_applied',
      productTimeProfileVersion: profile.version,
      processCount: profile.entries.length,
    };
  }

  if (existing) {
    const canReplace = canReplaceDraftRouteWithProductTime(existing)
      || canUpgradeUnstartedConfirmedProductTimeRoute(existing);
    if (!canReplace) {
      throw new ProductTimeRouteLinkError(
        '该工单已经开工或产生报工记录，现有路线已锁定，不能覆盖',
        409,
        'PRODUCT_TIME_ROUTE_LOCKED',
      );
    }
    const result = await applyPublishedProductTimeToUnstartedRoute(tx, {
      route: existing,
      profile,
      actorId: input.actorId,
      activityContent: existing.productTimeProfileVersion
        ? `手动升级到产品工序与工时 V${profile.version}`
        : `手动应用产品工序与工时 V${profile.version}`,
    });
    if (!result.updated) {
      throw new ProductTimeRouteLinkError(
        '工单路线状态刚刚发生变化，请刷新后重试',
        409,
        'PRODUCT_TIME_ROUTE_CONFLICT',
      );
    }
    return {
      routeId: existing.id,
      action: 'updated',
      productTimeProfileVersion: profile.version,
      processCount: profile.entries.length,
    };
  }

  if (!canMaterializeProductTimeRouteForWorkOrder(workOrder)) {
    throw new ProductTimeRouteLinkError(
      '该工单已经进入生产或存在历史进度，不能自动生成路线，请人工核对',
      409,
      'PRODUCT_TIME_ROUTE_REVIEW_REQUIRED',
    );
  }
  const created = await createWorkOrderProcessRoute(tx, {
    workOrderId: workOrder.id,
    actorId: input.actorId,
  });
  return {
    routeId: created.routeId,
    action: 'created',
    productTimeProfileVersion: profile.version,
    processCount: profile.entries.length,
  };
}

export async function repairHistoricalProductTimeRoute(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    currentProductTimeEntryId: string;
    processedQuantity: number;
    actorId?: string | null;
  },
): Promise<{
  routeId: string;
  productTimeProfileVersion: number;
  currentProcessName: string;
  processCount: number;
}> {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: input.workOrderId },
    select: {
      id: true,
      deletedAt: true,
      drawingLibraryItemId: true,
      specification: true,
      stage: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastProgressAt: true,
      progress: true,
      completedQty: true,
      uncompletedQty: true,
      productionTargetQty: true,
      frontendTransferredQty: true,
      branchType: true,
      planActive: true,
      planClearedAt: true,
      processRoute: {
        select: {
          id: true,
          version: true,
          status: true,
          routeSource: true,
          startedAt: true,
          steps: {
            select: {
              status: true,
              startedAt: true,
              completedAt: true,
              inputQty: true,
              processedQty: true,
              goodOutputQty: true,
              defectOutputQty: true,
              releasedGoodQty: true,
              _count: { select: { executions: true, completions: true } },
            },
          },
        },
      },
    },
  });
  if (!workOrder || workOrder.deletedAt) {
    throw new ProductTimeRouteLinkError('工单不存在或已经删除', 404, 'WORK_ORDER_NOT_FOUND');
  }
  if (!workOrder.drawingLibraryItemId) {
    throw new ProductTimeRouteLinkError('当前工单尚未关联产品资料', 409, 'PRODUCT_TIME_ITEM_MISSING');
  }
  if (!canRepairHistoricalProductTimeRoute({ workOrder, route: workOrder.processRoute })) {
    throw new ProductTimeRouteLinkError(
      '当前工单已有真实工序报工或已完成，不能按历史起点重建路线',
      409,
      'HISTORICAL_ROUTE_REPAIR_LOCKED',
    );
  }

  const profile = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId: workOrder.drawingLibraryItemId, status: 'published' },
    include: productTimeProfileInclude,
    orderBy: { version: 'desc' },
  });
  if (!profile?.entries.length) {
    throw new ProductTimeRouteLinkError(
      '当前产品没有已发布工序与工时',
      409,
      'PRODUCT_TIME_PROFILE_MISSING',
    );
  }
  const currentEntry = profile.entries.find(entry => entry.id === input.currentProductTimeEntryId);
  if (!currentEntry) {
    throw new ProductTimeRouteLinkError(
      '所选历史起点不属于当前已发布工艺，请刷新后重试',
      409,
      'HISTORICAL_ROUTE_STEP_CHANGED',
    );
  }

  const quantity = getProductionQuantitySummary(workOrder);
  const targetQuantity = Math.max(0, Number(quantity.targetQty || 0));
  const transferredQuantity = Math.min(
    targetQuantity,
    Math.max(0, Number(workOrder.frontendTransferredQty || 0)),
  );
  const currentInputQuantity = currentEntry.processDefinition.stageGroup === 'frontend'
    ? targetQuantity
    : transferredQuantity || targetQuantity;
  if (
    !Number.isInteger(input.processedQuantity)
    || input.processedQuantity < 0
    || input.processedQuantity > currentInputQuantity
  ) {
    throw new ProductTimeRouteLinkError(
      `历史已完成数量必须是 0-${currentInputQuantity} 的整数`,
      400,
      'HISTORICAL_ROUTE_QUANTITY_INVALID',
    );
  }

  const now = new Date();
  const historicalAt = workOrder.lastProgressAt || workOrder.startedAt || now;
  const currentSequenceGroup = currentEntry.sequenceGroup;
  const firstEntryByGroup = new Map<number, ProductTimeProfileRecord['entries'][number]>();
  profile.entries.forEach(entry => {
    if (!firstEntryByGroup.has(entry.sequenceGroup)) firstEntryByGroup.set(entry.sequenceGroup, entry);
  });
  const stepRows = profile.entries.map(entry => {
    const beforeCurrent = entry.sequenceGroup < currentSequenceGroup;
    const isCurrent = entry.sequenceGroup === currentSequenceGroup;
    const groupEntry = firstEntryByGroup.get(entry.sequenceGroup) || entry;
    const groupInputQuantity = groupEntry.processDefinition.stageGroup === 'frontend'
      ? targetQuantity
      : transferredQuantity || targetQuantity;
    const completedBaseline = beforeCurrent ? groupInputQuantity : isCurrent ? input.processedQuantity : 0;
    const status: ProcessStepStatus = beforeCurrent ? 'completed' : isCurrent ? 'current' : 'pending';
    return {
      processDefinitionId: entry.processDefinitionId,
      processCode: entry.processDefinition.code,
      processName: entry.processDefinition.name,
      stageGroup: entry.processDefinition.stageGroup,
      position: entry.position,
      sequenceGroup: entry.sequenceGroup,
      ...productTimeStandardSnapshot(profile, entry),
      inputQty: beforeCurrent || isCurrent ? groupInputQuantity : 0,
      processedQty: completedBaseline,
      goodOutputQty: completedBaseline,
      defectOutputQty: 0,
      releasedGoodQty: completedBaseline,
      status,
      startedAt: beforeCurrent || isCurrent ? historicalAt : null,
      completedAt: beforeCurrent ? historicalAt : null,
      remark: beforeCurrent
        ? '历史路线补齐：仅建立数量基线，不生成历史员工工时'
        : isCurrent ? '历史路线补齐：从核对后的当前工序继续执行' : null,
    };
  });

  let routeId: string;
  if (workOrder.processRoute) {
    const updated = await tx.workOrderProcessRoute.updateMany({
      where: {
        id: workOrder.processRoute.id,
        version: workOrder.processRoute.version,
        routeSource: PRODUCT_TIME_PENDING_ROUTE_SOURCE,
        steps: {
          every: {
            inputQty: 0,
            processedQty: 0,
            goodOutputQty: 0,
            defectOutputQty: 0,
            releasedGoodQty: 0,
            executions: { none: {} },
            completions: { none: {} },
          },
        },
      },
      data: {
        templateId: null,
        templateName: `${workOrder.specification || '当前产品'} 产品工时`,
        templateVersion: profile.version,
        productTimeProfileId: profile.id,
        productTimeProfileVersion: profile.version,
        routeSource: 'product_time_profile',
        status: 'in_progress',
        confirmedAt: now,
        confirmedById: input.actorId || null,
        startedAt: workOrder.processRoute.startedAt || workOrder.startedAt || now,
        completedAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProductTimeRouteLinkError(
        '工单路线刚刚发生变化，请刷新后重新核对',
        409,
        'HISTORICAL_ROUTE_REPAIR_CONFLICT',
      );
    }
    routeId = workOrder.processRoute.id;
    await tx.workOrderProcessStep.deleteMany({ where: { routeId } });
  } else {
    const created = await tx.workOrderProcessRoute.create({
      data: {
        workOrderId: workOrder.id,
        templateName: `${workOrder.specification || '当前产品'} 产品工时`,
        templateVersion: profile.version,
        productTimeProfileId: profile.id,
        productTimeProfileVersion: profile.version,
        routeSource: 'product_time_profile',
        status: 'in_progress',
        confirmedAt: now,
        confirmedById: input.actorId || null,
        startedAt: workOrder.startedAt || now,
        version: 1,
      },
      select: { id: true },
    });
    routeId = created.id;
  }

  await tx.workOrderProcessStep.createMany({
    data: stepRows.map(step => ({ routeId, ...step })),
  });
  await tx.processRouteActivity.create({
    data: {
      routeId,
      action: 'repair_historical_product_time_route',
      content: `历史工艺已核对到产品工序与工时 V${profile.version}，从“${currentEntry.processDefinition.name}”继续执行`,
      actorId: input.actorId || null,
      detail: {
        productTimeProfileId: profile.id,
        productTimeProfileVersion: profile.version,
        currentProductTimeEntryId: currentEntry.id,
        currentProcessName: currentEntry.processDefinition.name,
        targetQuantity,
        transferredQuantity,
        processedQuantity: input.processedQuantity,
        legacyStage: workOrder.stage,
      },
    },
  });
  const nextStage = processStageForGroup(
    normalizeProcessStageGroup(currentEntry.processDefinition.stageGroup) || 'frontend',
  );
  await tx.workOrder.update({
    where: { id: workOrder.id },
    data: {
      stage: nextStage,
      status: legacyStatusForStage(nextStage),
      startedAt: workOrder.startedAt || now,
      latestProgressRemark: `历史工艺起点已核对：${currentEntry.processDefinition.name}`,
      executionVersion: { increment: 1 },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId || null,
      action: 'repair_historical_product_time_route',
      targetType: 'work_order_process_route',
      targetId: routeId,
      detail: {
        workOrderId: workOrder.id,
        productTimeProfileId: profile.id,
        productTimeProfileVersion: profile.version,
        currentProductTimeEntryId: currentEntry.id,
        processedQuantity: input.processedQuantity,
      },
    },
  });
  return {
    routeId,
    productTimeProfileVersion: profile.version,
    currentProcessName: currentEntry.processDefinition.name,
    processCount: profile.entries.length,
  };
}

type ActiveProductTimeRouteSyncResult = {
  updated: boolean;
  fullySynchronized: boolean;
  reviewRequired: boolean;
  changedStepCount: number;
};

function activeRouteSyncSkipped(reviewRequired = false): ActiveProductTimeRouteSyncResult {
  return { updated: false, fullySynchronized: false, reviewRequired, changedStepCount: 0 };
}

function activeRouteStepHasBlockingReferences(step: DraftRouteSyncRecord['steps'][number]): boolean {
  return step._count.dailyProcessTasks > 0
    || step._count.processLaborPools > 0
    || step._count.sourceQuantityMovements > 0
    || step._count.targetQuantityMovements > 0;
}

function productTimeStepSnapshotMatches(
  step: DraftRouteSyncRecord['steps'][number],
  profile: ProductTimeProfileRecord,
  entry: ProductTimeProfileRecord['entries'][number],
  includeStructure = false,
): boolean {
  const snapshot = productTimeStandardSnapshot(profile, entry);
  return step.processDefinitionId === entry.processDefinitionId
    && step.processCode === entry.processDefinition.code
    && step.processName === entry.processDefinition.name
    && step.stageGroup === (normalizeProcessStageGroup(entry.processDefinition.stageGroup) || 'frontend')
    && (!includeStructure || (step.position === entry.position && step.sequenceGroup === entry.sequenceGroup))
    && step.standardTimeId === snapshot.standardTimeId
    && step.standardVersion === snapshot.standardVersion
    && step.productTimeProfileId === snapshot.productTimeProfileId
    && step.productTimeEntryId === snapshot.productTimeEntryId
    && step.productTimeProfileVersion === snapshot.productTimeProfileVersion
    && step.standardSource === snapshot.standardSource
    && step.timeBasis === snapshot.timeBasis
    && step.unitLabel === snapshot.unitLabel
    && step.standardMillisecondsPerUnit === snapshot.standardMillisecondsPerUnit
    && step.setupMilliseconds === snapshot.setupMilliseconds
    && step.unitsPerProduct === snapshot.unitsPerProduct
    && step.countsForEfficiency === snapshot.countsForEfficiency
    && step.remark === entry.remark;
}

function routeProductTimeMetadataMatches(
  route: DraftRouteSyncRecord,
  profile: ProductTimeProfileRecord,
): boolean {
  return route.routeSource === 'product_time_profile'
    && route.productTimeProfileId === profile.id
    && route.productTimeProfileVersion === profile.version
    && route.templateVersion === profile.version;
}

async function synchronizeStartedFactFreeProductTimeRoute(
  tx: Prisma.TransactionClient,
  input: {
    route: DraftRouteSyncRecord;
    profile: ProductTimeProfileRecord;
    actorId: string;
  },
): Promise<ActiveProductTimeRouteSyncResult> {
  if (!canSynchronizeStartedFactFreeProductTimeRoute(input.route)) return activeRouteSyncSkipped();

  const alreadySynchronized = routeProductTimeMetadataMatches(input.route, input.profile)
    && input.route.steps.length === input.profile.entries.length
    && input.profile.entries.every(entry => {
      const step = input.route.steps.find(candidate => candidate.processDefinitionId === entry.processDefinitionId);
      return step ? productTimeStepSnapshotMatches(step, input.profile, entry, true) : false;
    });
  if (alreadySynchronized) return activeRouteSyncSkipped();

  const entriesByDefinition = new Map(
    input.profile.entries.map(entry => [entry.processDefinitionId, entry] as const),
  );
  const existingByDefinition = new Map(
    input.route.steps
      .filter(step => Boolean(step.processDefinitionId))
      .map(step => [step.processDefinitionId as string, step] as const),
  );
  const removedSteps = input.route.steps.filter(step => (
    !step.processDefinitionId || !entriesByDefinition.has(step.processDefinitionId)
  ));
  if (removedSteps.some(activeRouteStepHasBlockingReferences)) {
    return activeRouteSyncSkipped(true);
  }

  const routeUpdate = await tx.workOrderProcessRoute.updateMany({
    where: {
      id: input.route.id,
      version: input.route.version,
      status: 'in_progress',
      routeSource: 'product_time_profile',
    },
    data: {
      templateId: null,
      templateName: `${input.route.workOrder.specification || '当前产品'} 产品工时`,
      templateVersion: input.profile.version,
      productTimeProfileId: input.profile.id,
      productTimeProfileVersion: input.profile.version,
      routeSource: 'product_time_profile',
      version: { increment: 1 },
    },
  });
  if (routeUpdate.count !== 1) return activeRouteSyncSkipped(true);

  // Move existing positions out of the final range first so reordering never
  // collides with the per-route unique position constraint.
  if (input.route.steps.length > 0) {
    await tx.workOrderProcessStep.updateMany({
      where: { routeId: input.route.id },
      data: { position: { increment: 1_000 } },
    });
  }

  const firstSequenceGroup = input.profile.entries[0]?.sequenceGroup;
  const initialInputQty = getProductionQuantitySummary(input.route.workOrder).targetQty || 0;
  const startedAt = input.route.startedAt || new Date();
  for (const entry of input.profile.entries) {
    const current = existingByDefinition.get(entry.processDefinitionId);
    const isCurrentGroup = entry.sequenceGroup === firstSequenceGroup;
    const data = {
      processDefinitionId: entry.processDefinitionId,
      processCode: entry.processDefinition.code,
      processName: entry.processDefinition.name,
      stageGroup: normalizeProcessStageGroup(entry.processDefinition.stageGroup) || 'frontend',
      position: entry.position,
      sequenceGroup: entry.sequenceGroup,
      ...productTimeStandardSnapshot(input.profile, entry),
      inputQty: isCurrentGroup ? initialInputQty : 0,
      processedQty: 0,
      goodOutputQty: 0,
      defectOutputQty: 0,
      releasedGoodQty: 0,
      status: isCurrentGroup ? 'current' : 'pending',
      startedAt: isCurrentGroup ? startedAt : null,
      completedAt: null,
      completedById: null,
      remark: entry.remark,
      quantityVersion: { increment: 1 },
    } as const;
    if (current) {
      await tx.workOrderProcessStep.update({ where: { id: current.id }, data });
    } else {
      const { quantityVersion: _quantityVersion, ...createData } = data;
      await tx.workOrderProcessStep.create({
        data: {
          routeId: input.route.id,
          ...createData,
        },
      });
    }
  }
  if (removedSteps.length > 0) {
    await tx.workOrderProcessStep.deleteMany({
      where: { id: { in: removedSteps.map(step => step.id) } },
    });
  }

  const currentNames = input.profile.entries
    .filter(entry => entry.sequenceGroup === firstSequenceGroup)
    .map(entry => entry.processDefinition.name)
    .join('、');
  await tx.workOrder.update({
    where: { id: input.route.workOrderId },
    data: { latestProgressRemark: `当前工序：${currentNames}` },
  });
  await tx.processRouteActivity.create({
    data: {
      routeId: input.route.id,
      action: 'sync_active_product_time_route',
      content: `产品工序与工时 V${input.profile.version} 已自动同步到零报工在制路线`,
      actorId: input.actorId,
      detail: {
        previousProductTimeProfileId: input.route.productTimeProfileId,
        previousProductTimeProfileVersion: input.route.productTimeProfileVersion,
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
        changedStepCount: input.profile.entries.length,
        addedStepCount: input.profile.entries.filter(entry => !existingByDefinition.has(entry.processDefinitionId)).length,
        removedStepCount: removedSteps.length,
        routeVersion: input.route.version + 1,
      },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: 'sync_active_product_time_route',
      targetType: 'work_order_process_route',
      targetId: input.route.id,
      detail: {
        workOrderId: input.route.workOrderId,
        previousProductTimeProfileId: input.route.productTimeProfileId,
        previousProductTimeProfileVersion: input.route.productTimeProfileVersion,
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
        mode: 'fact_free_full_sync',
        routeVersion: input.route.version + 1,
      },
    },
  });
  return {
    updated: true,
    fullySynchronized: true,
    reviewRequired: false,
    changedStepCount: input.profile.entries.length,
  };
}

async function synchronizeRemainingActiveProductTimeStandards(
  tx: Prisma.TransactionClient,
  input: {
    route: DraftRouteSyncRecord;
    profile: ProductTimeProfileRecord;
    actorId: string;
  },
): Promise<ActiveProductTimeRouteSyncResult> {
  if (input.route.status !== 'in_progress' || input.route.routeSource !== 'product_time_profile') {
    return activeRouteSyncSkipped();
  }
  const entriesByDefinition = new Map(
    input.profile.entries.map(entry => [entry.processDefinitionId, entry] as const),
  );
  const unfinishedSteps = input.route.steps.filter(step => step.status !== 'completed' && step.status !== 'skipped');
  const matchedSteps = unfinishedSteps.flatMap(step => {
    const entry = step.processDefinitionId ? entriesByDefinition.get(step.processDefinitionId) : null;
    return entry ? [{ step, entry }] : [];
  });
  if (matchedSteps.length === 0) return activeRouteSyncSkipped(true);

  const routeDefinitionIds = new Set(input.route.steps.map(step => step.processDefinitionId).filter(Boolean));
  const profileHasNewSteps = input.profile.entries.some(entry => !routeDefinitionIds.has(entry.processDefinitionId));
  const unfinishedHasRemovedSteps = unfinishedSteps.some(step => (
    !step.processDefinitionId || !entriesByDefinition.has(step.processDefinitionId)
  ));
  const sequenceChanged = matchedSteps.some(({ step, entry }) => (
    step.position !== entry.position || step.sequenceGroup !== entry.sequenceGroup
  ));
  const reviewRequired = profileHasNewSteps || unfinishedHasRemovedSteps || sequenceChanged;
  const alreadySynchronized = routeProductTimeMetadataMatches(input.route, input.profile)
    && matchedSteps.every(({ step, entry }) => productTimeStepSnapshotMatches(step, input.profile, entry));
  if (alreadySynchronized) return activeRouteSyncSkipped(reviewRequired);

  const routeUpdate = await tx.workOrderProcessRoute.updateMany({
    where: {
      id: input.route.id,
      version: input.route.version,
      status: 'in_progress',
      routeSource: 'product_time_profile',
    },
    data: {
      templateId: null,
      templateName: `${input.route.workOrder.specification || '当前产品'} 产品工时`,
      templateVersion: input.profile.version,
      productTimeProfileId: input.profile.id,
      productTimeProfileVersion: input.profile.version,
      version: { increment: 1 },
    },
  });
  if (routeUpdate.count !== 1) return activeRouteSyncSkipped(true);

  for (const { step, entry } of matchedSteps) {
    await tx.workOrderProcessStep.update({
      where: { id: step.id },
      data: {
        processDefinitionId: entry.processDefinitionId,
        processCode: entry.processDefinition.code,
        processName: entry.processDefinition.name,
        stageGroup: normalizeProcessStageGroup(entry.processDefinition.stageGroup) || 'frontend',
        ...productTimeStandardSnapshot(input.profile, entry),
        remark: entry.remark,
      },
    });
  }

  const currentNames = matchedSteps
    .filter(({ step }) => step.status === 'current')
    .map(({ entry }) => entry.processDefinition.name)
    .join('、');
  if (currentNames) {
    await tx.workOrder.update({
      where: { id: input.route.workOrderId },
      data: { latestProgressRemark: `当前工序：${currentNames}` },
    });
  }
  await tx.processRouteActivity.create({
    data: {
      routeId: input.route.id,
      action: 'sync_active_product_time_route',
      content: reviewRequired
        ? `产品工序与工时 V${input.profile.version} 已同步到未完工工序，结构变化等待主管复核`
        : `产品工序与工时 V${input.profile.version} 已同步到未完工工序，历史完工保留原快照`,
      actorId: input.actorId,
      detail: {
        previousProductTimeProfileId: input.route.productTimeProfileId,
        previousProductTimeProfileVersion: input.route.productTimeProfileVersion,
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
        changedStepCount: matchedSteps.length,
        reviewRequired,
        routeVersion: input.route.version + 1,
      },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: 'sync_active_product_time_route',
      targetType: 'work_order_process_route',
      targetId: input.route.id,
      detail: {
        workOrderId: input.route.workOrderId,
        previousProductTimeProfileId: input.route.productTimeProfileId,
        previousProductTimeProfileVersion: input.route.productTimeProfileVersion,
        productTimeProfileId: input.profile.id,
        productTimeProfileVersion: input.profile.version,
        mode: 'remaining_steps_sync',
        changedStepCount: matchedSteps.length,
        reviewRequired,
        routeVersion: input.route.version + 1,
      },
    },
  });
  return {
    updated: true,
    // A route with production facts deliberately keeps completed process
    // snapshots unchanged.  Even without a structural conflict this is a
    // partial (remaining-steps-only) synchronization, not a full rewrite.
    fullySynchronized: false,
    reviewRequired,
    changedStepCount: matchedSteps.length,
  };
}

type PublishedProductTimeRouteApplyResult = {
  updated: boolean;
  activeUpdated: boolean;
  partiallyUpdated: boolean;
  started: boolean;
  reviewRequired: boolean;
};

async function applyPublishedProductTimeToRoute(
  tx: Prisma.TransactionClient,
  input: {
    route: DraftRouteSyncRecord;
    profile: ProductTimeProfileRecord;
    actorId: string;
  },
): Promise<PublishedProductTimeRouteApplyResult> {
  const unstarted = await applyPublishedProductTimeToUnstartedRoute(tx, {
    route: input.route,
    profile: input.profile,
    actorId: input.actorId,
    activityContent: input.route.status === 'confirmed'
      ? `产品工序与工时 V${input.profile.version} 已发布，自动升级完全未开工路线`
      : `产品工序与工时 V${input.profile.version} 已发布，自动替换旧草稿并确认`,
  });
  if (unstarted.updated) {
    return {
      updated: true,
      activeUpdated: false,
      partiallyUpdated: false,
      started: unstarted.started,
      reviewRequired: false,
    };
  }

  const factFree = await synchronizeStartedFactFreeProductTimeRoute(tx, input);
  if (factFree.updated) {
    return {
      updated: true,
      activeUpdated: true,
      partiallyUpdated: false,
      started: false,
      reviewRequired: factFree.reviewRequired,
    };
  }

  const remaining = await synchronizeRemainingActiveProductTimeStandards(tx, input);
  if (remaining.updated) {
    return {
      updated: true,
      activeUpdated: true,
      partiallyUpdated: !remaining.fullySynchronized,
      started: false,
      reviewRequired: remaining.reviewRequired,
    };
  }
  return {
    updated: false,
    activeUpdated: false,
    partiallyUpdated: false,
    started: false,
    reviewRequired: factFree.reviewRequired || remaining.reviewRequired,
  };
}

export async function syncProductTimeRouteFromPublishedProductTime(
  tx: Prisma.TransactionClient,
  input: { routeId: string; profileId: string; actorId: string },
): Promise<PublishedProductTimeRouteApplyResult & { routeVersion: number | null }> {
  const [profile, route] = await Promise.all([
    tx.productTimeProfile.findUnique({
      where: { id: input.profileId },
      include: productTimeProfileInclude,
    }),
    tx.workOrderProcessRoute.findUnique({
      where: { id: input.routeId },
      include: draftRouteSyncInclude,
    }),
  ]);
  if (!profile || profile.status !== 'published' || !route) {
    return {
      updated: false,
      activeUpdated: false,
      partiallyUpdated: false,
      started: false,
      reviewRequired: false,
      routeVersion: route?.version ?? null,
    };
  }
  const result = await applyPublishedProductTimeToRoute(tx, {
    route,
    profile,
    actorId: input.actorId,
  });
  const current = result.updated
    ? await tx.workOrderProcessRoute.findUnique({ where: { id: route.id }, select: { version: true } })
    : { version: route.version };
  return { ...result, routeVersion: current?.version ?? null };
}

export async function syncDraftRoutesFromPublishedProductTime(
  tx: Prisma.TransactionClient,
  input: { profileId: string; actorId: string },
): Promise<{
  updated: number;
  activeUpdated: number;
  partiallyUpdated: number;
  created: number;
  started: number;
  skipped: number;
  reviewRequired: number;
}> {
  const profile = await tx.productTimeProfile.findUnique({
    where: { id: input.profileId },
    include: productTimeProfileInclude,
  });
  if (!profile || profile.status !== 'published') {
    return {
      updated: 0,
      activeUpdated: 0,
      partiallyUpdated: 0,
      created: 0,
      started: 0,
      skipped: 0,
      reviewRequired: 0,
    };
  }

  const routes = await tx.workOrderProcessRoute.findMany({
    where: {
      workOrder: { drawingLibraryItemId: profile.drawingLibraryItemId },
      OR: [
        { status: 'draft' },
        {
          status: 'confirmed',
          startedAt: null,
          routeSource: { in: [...AUTO_UPGRADE_PRODUCT_TIME_ROUTE_SOURCES] },
        },
        {
          status: 'in_progress',
          routeSource: 'product_time_profile',
        },
      ],
    },
    include: draftRouteSyncInclude,
  });
  let updated = 0;
  let created = 0;
  let started = 0;
  let skipped = 0;
  let activeUpdated = 0;
  let partiallyUpdated = 0;
  let activeReviewRequired = 0;

  for (const route of routes) {
    const result = await applyPublishedProductTimeToRoute(tx, {
      route,
      profile,
      actorId: input.actorId,
    });
    if (result.updated) {
      updated += 1;
      if (result.started) started += 1;
      if (result.activeUpdated) activeUpdated += 1;
      if (result.partiallyUpdated) partiallyUpdated += 1;
      if (result.reviewRequired) activeReviewRequired += 1;
      continue;
    }
    if (result.reviewRequired) activeReviewRequired += 1;
    skipped += 1;
  }

  const missingRouteOrders = await tx.workOrder.findMany({
    where: {
      deletedAt: null,
      planType: { in: ['weekly_plan', 'managed_plan'] },
      planClearedAt: null,
      branchType: null,
      drawingLibraryItemId: profile.drawingLibraryItemId,
      processRoute: null,
    },
    select: {
      id: true,
      stage: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastProgressAt: true,
      progress: true,
      completedQty: true,
      uncompletedQty: true,
      productionTargetQty: true,
      frontendTransferredQty: true,
      branchType: true,
      planActive: true,
      planClearedAt: true,
    },
  });
  for (const workOrder of missingRouteOrders) {
    if (!canMaterializeProductTimeRouteForWorkOrder(workOrder)) {
      skipped += 1;
      continue;
    }
    const result = await createWorkOrderProcessRoute(tx, {
      workOrderId: workOrder.id,
      actorId: input.actorId,
    });
    if (result.created) created += 1;
  }
  const reviewCandidates = await tx.workOrder.findMany({
    where: {
      deletedAt: null,
      completedAt: null,
      planType: { in: ['weekly_plan', 'managed_plan'] },
      planClearedAt: null,
      branchType: null,
      drawingLibraryItemId: profile.drawingLibraryItemId,
    },
    select: {
      stage: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lastProgressAt: true,
      progress: true,
      completedQty: true,
      uncompletedQty: true,
      productionTargetQty: true,
      frontendTransferredQty: true,
      branchType: true,
      planActive: true,
      planClearedAt: true,
      processRoute: {
        select: {
          status: true,
          routeSource: true,
          startedAt: true,
          steps: {
            select: {
              status: true,
              startedAt: true,
              completedAt: true,
              inputQty: true,
              processedQty: true,
              goodOutputQty: true,
              defectOutputQty: true,
              releasedGoodQty: true,
              _count: { select: { executions: true, completions: true } },
            },
          },
        },
      },
    },
  });
  const historicalReviewRequired = reviewCandidates.filter(workOrder => (
    canRepairHistoricalProductTimeRoute({
      workOrder,
      route: workOrder.processRoute,
    })
  )).length;
  return {
    updated,
    activeUpdated,
    partiallyUpdated,
    created,
    started,
    skipped,
    reviewRequired: historicalReviewRequired + activeReviewRequired,
  };
}

export function processTemplateStepInput(step: ProcessTemplateStepDTO): ValidatedProcessStep {
  return {
    processDefinitionId: step.processDefinitionId || null,
    processCode: step.processCode,
    processName: step.processName,
    stageGroup: step.stageGroup,
    position: step.position,
    sequenceGroup: step.position,
    unitsPerProduct: step.unitsPerProduct || 1,
  };
}
