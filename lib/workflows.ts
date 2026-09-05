import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  productionTeamScopeWhere,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';
import { chinaDateKey } from '@/lib/china-date';
import { dateKeyFromDatabase } from '@/lib/attendance';
import { changeCode, changeStatusLabels, changeTypeLabels } from '@/lib/changes';
import { issueCode, issueStatusLabels, issueTypeLabels } from '@/lib/issues';
import { PLANNING_FLOW_STEPS, planningFlowStepStates, resolvePlanningFlow } from '@/lib/planning-flow';
import { productTimeTotalMilliseconds } from '@/lib/product-time';
import { resolveProductionLifecycle } from '@/lib/production-lifecycle';
import { chinaWeekRange } from '@/lib/production-planning';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import {
  canMaterializeProductTimeRouteForWorkOrder,
  canRepairHistoricalProductTimeRoute,
  canReplaceDraftRouteWithProductTime,
  canUpgradeUnstartedConfirmedProductTimeRoute,
} from '@/lib/process-routing';
import { normalizeWorkOrderStage } from '@/lib/work-orders';
import { productTimeConfigurationRoute } from '@/lib/workflow-routes';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';
import { productionCarryoverDayWindow } from '@/lib/production-carryovers';
import { processRouteStepChangeSnapshots } from '@/lib/process-route-change-contract';
import {
  processSupplementActualRequiredQty,
  processSupplementRemainingQty,
} from '@/lib/process-supplement-coverage';
import type {
  ChangeStatus,
  ChangeType,
  IssueStatus,
  IssueType,
  ProcessRouteStatus,
  ProcessStageGroup,
  ProcessStepStatus,
  ProductionPlanReleaseState,
  WarehouseMaterialStatus,
  WorkflowActivityDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowTemplateDTO,
  WorkflowWeekNavigationDTO,
  WorkflowWeekScope,
} from '@/types';

type ProductTimeLinkRoute = {
  status: string;
  routeSource: string;
  productTimeProfileVersion: number | null;
  startedAt: Date | null;
  steps: Array<{
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    inputQty: number;
    processedQty: number;
    goodOutputQty: number;
    defectOutputQty: number;
    releasedGoodQty: number;
    _count: { executions: number; completions: number };
  }>;
};

type ProductTimeLinkWorkOrder = {
  stage: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  lastProgressAt: Date | null;
  progress: number;
  completedQty: string | null;
  uncompletedQty: string | null;
  productionTargetQty: number | null;
  frontendTransferredQty: number | null;
  branchType: unknown;
  planActive: boolean;
  planClearedAt: Date | null;
  processRoute: ProductTimeLinkRoute | null;
};

function productTimeRouteLink(
  workOrder: ProductTimeLinkWorkOrder | null,
  availableVersion: number | null,
): Pick<
  WorkflowItemDTO,
  'productTimeRouteLinkState' | 'canApplyProductTimeProfile'
> {
  if (!availableVersion) {
    return { productTimeRouteLinkState: 'missing_profile', canApplyProductTimeProfile: false };
  }
  if (!workOrder) {
    return { productTimeRouteLinkState: 'available', canApplyProductTimeProfile: false };
  }
  const route = workOrder.processRoute;
  if (
    route?.routeSource === 'product_time_profile'
    && route.productTimeProfileVersion !== null
    && route.productTimeProfileVersion >= availableVersion
    && route.steps.length > 0
    && route.status !== 'draft'
  ) {
    return { productTimeRouteLinkState: 'linked', canApplyProductTimeProfile: false };
  }
  if (route) {
    const canApply = canReplaceDraftRouteWithProductTime(route)
      || canUpgradeUnstartedConfirmedProductTimeRoute(route);
    return {
      productTimeRouteLinkState: canApply
        && route.status === 'draft'
        && route.routeSource === 'product_time_profile'
        && route.productTimeProfileVersion !== null
        && route.productTimeProfileVersion >= availableVersion
        ? 'repair_required'
        : canApply && route.productTimeProfileVersion
          ? 'upgrade_available'
        : canApply ? 'available' : 'locked',
      canApplyProductTimeProfile: canApply,
    };
  }
  const canApply = canMaterializeProductTimeRouteForWorkOrder(workOrder);
  return {
    productTimeRouteLinkState: canApply ? 'available' : 'locked',
    canApplyProductTimeProfile: canApply,
  };
}

export const workflowTemplates: WorkflowTemplateDTO[] = [
  {
    key: 'issue',
    name: '问题闭环',
    description: '生产、计划与技术问题的受理、处理、验证和关闭。',
    steps: ['待受理', '处理中', '待验证', '已关闭'],
    route: '/workspace/issues',
  },
  {
    key: 'change',
    name: '变更闭环',
    description: '图纸、工艺、计划与物料变更的评估、执行和验证。',
    steps: ['草稿', '待评估', '执行中', '待验证', '已关闭'],
    route: '/workspace/changes',
  },
  {
    key: 'production',
    name: '生产流转',
    description: '准备校验完成后，严格按照产品已发布的真实工艺路线推进。',
    steps: ['准备校验', '真实产品工序', '完成归档'],
    route: '/weekly-plan-center',
  },
];

export function productionRouteFallback(params: {
  completed: boolean;
  started: boolean;
}): {
  currentStep: string;
  nextStep: string | null;
  steps: WorkflowStepDTO[];
} {
  if (params.completed) {
    return {
      currentStep: '生产已完成',
      nextStep: null,
      steps: [{ key: 'production-completed', label: '生产已完成', state: 'done' }],
    };
  }
  if (params.started) {
    return {
      currentStep: '历史工艺待补齐',
      nextStep: '补齐产品工序',
      steps: [{ key: 'route-repair-required', label: '历史工艺待补齐', state: 'current' }],
    };
  }
  return {
    currentStep: '工艺路线待配置',
    nextStep: '维护产品工序',
    steps: [{ key: 'route-configuration-required', label: '工艺路线待配置', state: 'current' }],
  };
}

function steps(labels: string[], currentIndex: number, closed = false): WorkflowStepDTO[] {
  return labels.map((label, index) => ({
    key: String(index),
    label,
    state: closed || index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
  }));
}

function processStatus(status: string, entityType: WorkflowEntityType): WorkflowProcessStatus {
  if (entityType === 'issue') {
    if (status === 'closed') return 'closed';
    if (status === 'verifying' || status === 'awaiting_confirmation') return 'verifying';
    return status === 'processing' ? 'processing' : 'waiting';
  }
  if (entityType === 'change') {
    if (status === 'closed') return 'closed';
    if (status === 'verifying') return 'verifying';
    return status === 'implementing' ? 'processing' : 'waiting';
  }
  if (status === 'completed') return 'closed';
  return status === 'frontend' || status === 'backend' ? 'processing' : 'waiting';
}

function nextLabel(labels: string[], index: number): string | null {
  return index >= 0 && index + 1 < labels.length ? labels[index + 1] : null;
}

function activity(id: string, action: string, label: string, actor: string | null | undefined, createdAt: Date): WorkflowActivityDTO {
  return { id, action, label, actor: actor || null, createdAt: createdAt.toISOString() };
}

function dedupeProductionActivities(items: WorkflowActivityDTO[]): WorkflowActivityDTO[] {
  const sorted = [...items].sort(
    (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  );
  const deduped: WorkflowActivityDTO[] = [];

  for (const item of sorted) {
    const duplicateIndex = deduped.findIndex(existing => (
      existing.label === item.label
      && (existing.actor || null) === (item.actor || null)
      && Math.abs(new Date(existing.createdAt).getTime() - new Date(item.createdAt).getTime()) <= 1_000
      && (existing.action === 'production_progress' || item.action === 'production_progress')
    ));
    if (duplicateIndex < 0) {
      deduped.push(item);
    } else if (deduped[duplicateIndex].action === 'production_progress' && item.action !== 'production_progress') {
      deduped[duplicateIndex] = item;
    }
  }

  return deduped;
}

function summary(items: WorkflowItemDTO[]): WorkflowSummaryDTO {
  const value: WorkflowSummaryDTO = {
    total: items.length, waiting: 0, processing: 0, verifying: 0, closed: 0, overdue: 0,
    issue: 0, change: 0, production: 0,
  };
  for (const item of items) {
    value[item.processStatus] += 1;
    value[item.entityType] += 1;
    if (item.isOverdue) value.overdue += 1;
  }
  return value;
}

type WorkflowRouteStepRecord = {
  id: string;
  processName: string;
  status: string;
  position: number;
  sequenceGroup: number;
  stageGroup: string;
  unitLabel: string | null;
  reportQuantityBasis: string;
  reportUnitLabel: string;
  standardMillisecondsPerUnit: number | null;
  executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
  isCritical: boolean;
  changeSource: 'EXISTING' | 'NEW';
  inputQty: number;
  processedQty: number;
  goodOutputQty: number;
  defectOutputQty: number;
  releasedGoodQty: number;
  startedAt: Date | null;
  completedAt: Date | null;
  remark: string | null;
  productTimeEntry: { remark: string | null } | null;
  executions: Array<{
    goodQty: number;
    endedAt: Date;
    employee: { name: string };
  }>;
  completions: Array<{
    id: string;
    workDate: Date;
    completedAt: Date;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    reportedUnitQty: number;
    reportedGoodUnitQty: number;
    reportedDefectUnitQty: number;
    reportQuantityBasis: string;
    reportUnitLabel: string;
    reportMode: string;
    coverageStatus: string;
    coveredQty: number;
    standardMillisecondsPerUnit: number | null;
    standardSource: string;
    participants: Array<{ employee: { name: string } }>;
    laborPool: {
      id: string;
      claimedQty: number;
    } | null;
  }>;
  processLaborPools: Array<{
    id: string;
    workDate: Date;
    eligibleQty: number;
    claimedQty: number;
    remainingQty: number;
    status: string;
    standardSource: string;
    createdAt: Date;
    claims: Array<{
      claimedAt: Date;
      employee: { name: string };
    }>;
  }>;
  supplementObligation: {
    requiredQty: number;
    systemCoveredQty: number;
    reportedQty: number;
    status: string;
    fulfillmentMode: 'ACTUAL' | 'MIXED' | 'SYSTEM_COVERED' | 'FUTURE_ONLY' | 'RECALL_REQUIRED';
    releasePolicy: string;
    isCritical: boolean;
  } | null;
};

type WorkflowRouteRecord = {
  id: string;
  status: string;
  version: number;
  templateName: string;
  templateVersion: number;
  productTimeProfileVersion: number | null;
  routeSource: string;
  confirmedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  productTimeProfile: { remark: string | null } | null;
  processRouteChanges: Array<{
    id: string;
    activatedRouteVersion: number | null;
    diffs: Array<{
      kind: 'INSERT_STEP' | 'UPDATE_TIME' | 'MOVE_STEP';
      targetStepId: string | null;
      beforeData: unknown;
    }>;
  }>;
  steps: WorkflowRouteStepRecord[];
};

type WorkflowPublishedProductTimeProfile = {
  version: number;
  entries: Array<{
    id: string;
    position: number;
    sequenceGroup: number;
    unitMilliseconds: number;
    unitLabel: string;
    reportQuantityBasis: string;
    reportUnitLabel: string;
    remark: string | null;
    processDefinition: {
      name: string;
      stageGroup: string;
    };
  }>;
};

function routeSteps(route: WorkflowRouteRecord, targetQuantity: number | null): WorkflowStepDTO[] {
  const changeSnapshots = processRouteStepChangeSnapshots(route.steps, route.processRouteChanges);
  return route.steps.map(step => {
    const supplement = step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
      ? step.supplementObligation
      : null;
    const displayedInputQuantity = supplement
      ? processSupplementActualRequiredQty(supplement)
      : step.inputQty;
    const displayedProcessedQuantity = supplement?.reportedQty ?? step.processedQty;
    const reportedGoodQuantity = supplement?.reportedQty ?? step.goodOutputQty;
    const reportedQuantity = supplement?.reportedQty
      ?? step.completions.reduce((total, completion) => total + completion.processedQty, 0);
    const reportTargetQuantity = supplement
      ? processSupplementActualRequiredQty(supplement)
      : targetQuantity ?? step.inputQty;
    const latestExecution = step.executions[0] || null;
    const latestCompletion = step.completions[0] || null;
    const laborClaims = step.processLaborPools
      .flatMap(pool => pool.claims)
      .sort((first, second) => second.claimedAt.getTime() - first.claimedAt.getTime());
    const laborClaimantNames = [...new Set(laborClaims.map(claim => claim.employee.name))];
    const latestClaim = laborClaims[0] || null;
    const latestReportedAt = [latestExecution?.endedAt, latestCompletion?.completedAt, latestClaim?.claimedAt]
      .filter((value): value is Date => Boolean(value))
      .sort((first, second) => second.getTime() - first.getTime())[0] || null;
    const laborEligibleQuantity = step.processLaborPools.reduce((total, pool) => total + pool.eligibleQty, 0);
    const laborClaimedQuantity = step.processLaborPools.reduce((total, pool) => total + pool.claimedQty, 0);
    const laborRemainingQuantity = step.processLaborPools.reduce((total, pool) => total + pool.remainingQty, 0);
    const targetLaborPool = [...step.processLaborPools]
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
      .find(pool => pool.remainingQty > 0 || pool.status === 'LOCKED')
      || [...step.processLaborPools].sort(
        (first, second) => second.createdAt.getTime() - first.createdAt.getTime(),
      )[0]
      || null;
    const changeSnapshot = changeSnapshots.get(step.id)!;
    return {
      key: step.id,
      label: step.processName,
      state: !supplement && reportedQuantity > displayedProcessedQuantity
        ? 'current'
        : step.status === 'skipped' ? 'skipped'
        : step.status === 'completed' ? 'done'
        : step.status === 'current'
          ? 'current'
          : 'pending',
      sequenceGroup: step.sequenceGroup,
      status: step.status as ProcessStepStatus,
      stageGroup: step.stageGroup as ProcessStageGroup,
      unitLabel: step.unitLabel || '件',
      reportQuantityBasis: step.reportQuantityBasis === 'action' ? 'action' : 'product',
      reportUnitLabel: step.reportUnitLabel || step.unitLabel || '件',
      standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
      executionMode: step.executionMode,
      isCritical: step.isCritical,
      changeSource: step.changeSource,
      changeTag: changeSnapshot.tag,
      changeVersion: changeSnapshot.changeVersion,
      sourceChangeId: changeSnapshot.sourceChangeId,
      previousStandardMillisecondsPerUnit: changeSnapshot.previousStandardMillisecondsPerUnit,
      inputQuantity: displayedInputQuantity,
      processedQuantity: displayedProcessedQuantity,
      reportedGoodQuantity,
      defectQuantity: step.defectOutputQty,
      releasedGoodQuantity: step.releasedGoodQty,
      remainingProcessQuantity: Math.max(0, displayedInputQuantity - displayedProcessedQuantity),
      systemCoveredQuantity: supplement?.systemCoveredQty || 0,
      actualRequiredQuantity: supplement ? processSupplementActualRequiredQty(supplement) : displayedInputQuantity,
      supplementRemainingQuantity: supplement ? processSupplementRemainingQty(supplement) : null,
      supplementFulfillmentMode: supplement?.fulfillmentMode || null,
      supplementReleasePolicy: supplement?.releasePolicy || null,
      reportTargetQuantity,
      reportedQuantity,
      materialInputQuantity: step.inputQty,
      materialProcessedQuantity: step.processedQty,
      laborEligibleQuantity,
      laborClaimedQuantity,
      laborRemainingQuantity,
      laborClaimantNames,
      hasLaborPool: step.processLaborPools.length > 0,
      laborPoolId: targetLaborPool?.id || null,
      laborWorkDate: targetLaborPool ? dateKeyFromDatabase(targetLaborPool.workDate) : null,
      laborPendingStandard: step.processLaborPools.some(pool => (
        pool.status === 'LOCKED' && pool.standardSource === 'pending_standard'
      )),
      startedAt: step.startedAt?.toISOString() || null,
      completedAt: step.completedAt?.toISOString() || null,
      remark: step.remark,
      productRemark: step.productTimeEntry?.remark || route.productTimeProfile?.remark || null,
      latestEmployeeName: laborClaimantNames.join('、') || latestExecution?.employee.name || null,
      latestReportedAt: latestReportedAt?.toISOString() || null,
      completionRecords: step.completions.map(completion => ({
        id: completion.id,
        workDate: dateKeyFromDatabase(completion.workDate),
        completedAt: completion.completedAt.toISOString(),
        processedQty: completion.processedQty,
        goodQty: completion.goodQty,
        defectQty: completion.defectQty,
        reportedUnitQty: completion.reportedUnitQty,
        reportedGoodUnitQty: completion.reportedGoodUnitQty,
        reportedDefectUnitQty: completion.reportedDefectUnitQty,
        reportQuantityBasis: completion.reportQuantityBasis === 'action' ? 'action' : 'product',
        reportUnitLabel: completion.reportUnitLabel || step.reportUnitLabel || step.unitLabel || '件',
        reportMode: completion.reportMode === 'ADVANCE' ? 'advance' : 'sequential',
        coverageStatus: completion.coverageStatus === 'PENDING'
          ? 'pending'
          : completion.coverageStatus === 'PARTIAL' ? 'partial' : 'covered',
        coveredQty: completion.coveredQty,
        pendingCoverageQty: Math.max(0, completion.processedQty - completion.coveredQty),
        participantNames: completion.participants.map(item => item.employee.name),
        laborPoolId: completion.laborPool?.id || null,
        laborClaimedQty: completion.laborPool?.claimedQty || 0,
        standardMillisecondsPerUnit: completion.standardMillisecondsPerUnit,
        standardSource: completion.standardSource,
      })),
    };
  });
}

function publishedReferenceRoute(
  profile: WorkflowPublishedProductTimeProfile | null,
  workOrder: ProductTimeLinkWorkOrder | null,
): {
  steps: WorkflowStepDTO[];
  repair: NonNullable<WorkflowItemDTO['historicalRouteRepair']>;
} | null {
  if (
    !profile?.entries.length
    || !workOrder
    || !canRepairHistoricalProductTimeRoute({ workOrder, route: workOrder.processRoute })
  ) return null;
  const stage = normalizeWorkOrderStage(workOrder.stage || workOrder.status) || 'not_issued';
  const quantity = getProductionQuantitySummary(workOrder);
  const targetQuantity = Math.max(0, Number(quantity.targetQty || 0));
  const transferredQuantity = Math.min(
    targetQuantity,
    Math.max(0, Number(workOrder.frontendTransferredQty || 0)),
  );
  const suggested = stage === 'backend'
    ? profile.entries.find(entry => entry.processDefinition.stageGroup !== 'frontend')
      || profile.entries.at(-1)
    : profile.entries.find(entry => entry.processDefinition.stageGroup === 'frontend')
      || profile.entries[0];
  if (!suggested) return null;
  const completedQuantity = Math.min(
    suggested.processDefinition.stageGroup === 'frontend'
      ? 0
      : transferredQuantity || targetQuantity,
    Math.max(0, Number(quantity.completedQty || 0)),
  );
  const steps = profile.entries.map((entry): WorkflowStepDTO => {
    const state: WorkflowStepDTO['state'] = entry.sequenceGroup < suggested.sequenceGroup
      ? 'done'
      : entry.sequenceGroup === suggested.sequenceGroup ? 'current' : 'pending';
    const groupInput = entry.processDefinition.stageGroup === 'frontend'
      ? targetQuantity
      : transferredQuantity || targetQuantity;
    const processed = state === 'done' ? groupInput : state === 'current' ? completedQuantity : 0;
    const stageGroup = entry.processDefinition.stageGroup === 'backend'
      || entry.processDefinition.stageGroup === 'finish'
      ? entry.processDefinition.stageGroup
      : 'frontend';
    const status: ProcessStepStatus = state === 'done' ? 'completed' : state === 'current' ? 'current' : 'pending';
    return {
      key: entry.id,
      label: entry.processDefinition.name,
      state,
      sequenceGroup: entry.sequenceGroup,
      status,
      stageGroup,
      unitLabel: entry.unitLabel || '套',
      reportQuantityBasis: entry.reportQuantityBasis === 'action' ? 'action' : 'product',
      reportUnitLabel: entry.reportUnitLabel || entry.unitLabel || '套',
      standardMillisecondsPerUnit: entry.unitMilliseconds,
      inputQuantity: state === 'pending' ? 0 : groupInput,
      processedQuantity: processed,
      reportedGoodQuantity: processed,
      defectQuantity: 0,
      releasedGoodQuantity: processed,
      remainingProcessQuantity: Math.max(0, groupInput - processed),
      laborEligibleQuantity: 0,
      laborClaimedQuantity: 0,
      laborRemainingQuantity: 0,
      laborClaimantNames: [],
      hasLaborPool: false,
      laborPendingStandard: false,
      remark: state === 'pending' ? null : '历史执行投影，确认起点后写入工单路线',
      productRemark: entry.remark,
    };
  });
  return {
    steps,
    repair: {
      suggestedStepKey: suggested.id,
      legacyStage: stage,
      targetQuantity,
      transferredQuantity,
      completedQuantity,
    },
  };
}

export function resolveWorkflowRouteState(
  route: Pick<WorkflowRouteRecord, 'status' | 'startedAt'>,
  mappedSteps: WorkflowStepDTO[],
  workOrderCompletedAt?: string | Date | null,
): {
  processStatus: WorkflowProcessStatus;
  currentStep: string;
  nextStep: string | null;
  closed: boolean;
} {
  const routeCompleted = route.status === 'completed'
    || (mappedSteps.length > 0 && mappedSteps.every(step => step.status === 'completed' || step.status === 'skipped'));
  const lifecycle = resolveProductionLifecycle({ routeCompleted, workOrderCompletedAt });
  const currentGroup = mappedSteps.filter(step => step.status === 'current');
  const firstPendingGroupNumber = mappedSteps.find(step => step.status === 'pending')?.sequenceGroup;
  const firstPendingGroup = mappedSteps.filter(step => (
    step.status === 'pending' && step.sequenceGroup === firstPendingGroupNumber
  ));
  const activeGroupNumber = currentGroup[0]?.sequenceGroup;
  const nextGroupNumber = mappedSteps.find(step => (
    step.status === 'pending'
    && (activeGroupNumber === undefined || (step.sequenceGroup || 0) > activeGroupNumber)
  ))?.sequenceGroup;
  const nextGroup = currentGroup.length > 0
    ? mappedSteps.filter(step => step.status === 'pending' && step.sequenceGroup === nextGroupNumber)
    : firstPendingGroup;
  return {
    processStatus: lifecycle.aggregateCompleted
      ? 'closed'
      : routeCompleted || route.status === 'in_progress'
        ? 'processing'
        : 'waiting',
    currentStep: lifecycle.aggregateCompleted
      ? '全部工序完成'
      : lifecycle.awaitingBranchClosure
        ? '主路线完成 · 待分支闭环'
        : currentGroup.length > 0
          ? currentGroup.map(step => step.label).join('、')
          : route.status === 'confirmed' && !route.startedAt
            ? '等待开始生产'
            : '等待工序开始',
    nextStep: lifecycle.awaitingBranchClosure
      ? '处理返工/补产分支'
      : nextGroup.length > 0
        ? nextGroup.map(step => step.label).join('、')
        : null,
    closed: lifecycle.aggregateCompleted,
  };
}

function addUtcDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function workflowWeekRanges(now = new Date()): Record<WorkflowWeekScope, { start: Date; end: Date }> {
  const current = chinaWeekRange(now);
  return {
    history: chinaWeekRange(addUtcDays(current.start, -7)),
    current,
    next: chinaWeekRange(addUtcDays(current.start, 7)),
    afterNext: chinaWeekRange(addUtcDays(current.start, 14)),
  };
}

export function workflowWeekRange(
  scope: WorkflowWeekScope,
  now = new Date(),
  historyWeekStartDate?: string | null,
): { start: Date; end: Date } {
  if (scope === 'history' && historyWeekStartDate) {
    const requested = parseWeek(historyWeekStartDate);
    if (requested) return { start: requested, end: addDays(requested, 6) };
  }
  return workflowWeekRanges(now)[scope];
}

export function workflowItemMatchesWeekScope(
  item: Pick<WorkflowItemDTO, 'entityType' | 'weekStartDate' | 'weekEndDate' | 'carryover'>,
  scope: WorkflowWeekScope,
  now = new Date(),
  historyWeekStartDate?: string | null,
): boolean {
  if (item.entityType !== 'production') return false;
  const weekStart = item.weekStartDate ? new Date(item.weekStartDate) : null;
  const weekEnd = item.weekEndDate ? new Date(item.weekEndDate) : null;
  const range = workflowWeekRange(scope, now, historyWeekStartDate);
  if (
    scope === 'current'
    && item.carryover?.targetWeekStartDate
    && item.carryover.targetWeekStartDate === chinaDateKey(range.start)
  ) return true;
  if (!weekStart && !weekEnd) return false;
  const rangeStartKey = chinaDateKey(range.start);
  const rangeEndKey = chinaDateKey(range.end);
  const weekStartKey = chinaDateKey(weekStart);
  const weekEndKey = chinaDateKey(weekEnd);
  if (weekStartKey) return weekStartKey === rangeStartKey;
  return Boolean(weekEndKey && weekEndKey >= rangeStartKey && weekEndKey <= rangeEndKey);
}

function productionExecutionRouteForWeek(
  workOrderId: string,
  weekStartDate: Date | null,
  now = new Date(),
  carriedToCurrent = false,
): string {
  const params = new URLSearchParams({ workOrderId });
  if (carriedToCurrent) {
    params.set('scope', 'current');
    return `/production?${params.toString()}`;
  }
  if (!weekStartDate) return `/production?${params.toString()}`;
  const ranges = workflowWeekRanges(now);
  const weekKey = chinaDateKey(weekStartDate);
  const currentKey = chinaDateKey(ranges.current.start);
  const nextKey = chinaDateKey(ranges.next.start);
  const afterNextKey = chinaDateKey(ranges.afterNext.start);
  if (weekKey < currentKey) {
    params.set('scope', 'history');
    params.set('weekStart', weekKey);
  } else if (weekKey === nextKey) {
    params.set('scope', 'next');
  } else if (weekKey === afterNextKey) {
    params.set('scope', 'afterNext');
  } else {
    params.set('scope', 'current');
  }
  return `/production?${params.toString()}`;
}

export type WorkflowCenterFilters = {
  keyword?: string;
  entityType?: WorkflowEntityType | 'all';
  status?: WorkflowProcessStatus | 'all';
  overdue?: boolean;
  batchId?: string;
  workOrderId?: string;
  weekScope?: WorkflowWeekScope;
  weekStartDate?: string;
  laborEmployeeTeam?: string;
  productionScope?: ProductionEntityScope;
  allowedEntityTypes?: readonly WorkflowEntityType[];
};

export function workflowEntityTypeMatchesFilter(
  itemType: WorkflowEntityType,
  requestedType: WorkflowEntityType | 'all',
): boolean {
  return requestedType === 'all' || itemType === requestedType;
}

export function workflowWeekNavigationFromBatches(
  batches: Array<{ weekStartDate: Date; weekEndDate: Date; carryovers?: Array<{ id: string }> }>,
  now = new Date(),
): WorkflowWeekNavigationDTO {
  const ranges = workflowWeekRanges(now);
  const item = (scope: 'current' | 'next' | 'afterNext') => ({
    weekStartDate: chinaDateKey(ranges[scope].start),
    weekEndDate: chinaDateKey(ranges[scope].end),
    count: batches.filter(batch => chinaDateKey(batch.weekStartDate) === chinaDateKey(ranges[scope].start)).length,
  });
  const historyMap = new Map<string, { weekStartDate: string; weekEndDate: string; count: number }>();
  const currentWeekStartDate = chinaDateKey(ranges.current.start);
  for (const batch of batches) {
    const weekStartDate = chinaDateKey(batch.weekStartDate);
    if (weekStartDate >= currentWeekStartDate) continue;
    const current = historyMap.get(weekStartDate);
    if (current) current.count += 1;
    else historyMap.set(weekStartDate, {
      weekStartDate,
      weekEndDate: chinaDateKey(batch.weekEndDate),
      count: 1,
    });
  }
  return {
    current: item('current'),
    next: item('next'),
    afterNext: item('afterNext'),
    carryoverCount: batches.filter(batch => Boolean(batch.carryovers?.length)).length,
    history: [...historyMap.values()]
      .sort((left, right) => right.weekStartDate.localeCompare(left.weekStartDate)),
  };
}

export async function loadWorkflowCenter(filters: WorkflowCenterFilters = {}): Promise<{
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
  navigation: WorkflowWeekNavigationDTO;
}> {
  const now = Date.now();
  const nowDate = new Date(now);
  const currentWeek = workflowWeekRanges(nowDate).current;
  const productionTeamWhere = filters.productionScope
    ? productionTeamScopeWhere(filters.productionScope) as Prisma.ProductionTeamWhereInput | null
    : null;
  const productionTaskScopeWhere: Prisma.DailyProcessTaskListRelationFilter | undefined = productionTeamWhere
    ? { some: { plan: { team: productionTeamWhere } } }
    : undefined;
  const [issues, changes, productionBatches, standaloneProductionOrders] = await Promise.all([
    prisma.issue.findMany({
      where: { deletedAt: null },
      select: {
        id: true, sequence: true, title: true, type: true, priority: true, status: true, dueAt: true, updatedAt: true,
        isMajorQuality: true,
        majorApprovals: {
          select: { id: true, status: true, round: true },
          orderBy: { round: 'desc' },
          take: 1,
        },
        assignee: { select: { username: true, displayName: true } },
        assigneeEmployee: { select: { employeeNo: true, name: true } },
        workOrder: { select: { code: true, specification: true, customerName: true } },
        activities: {
          select: { id: true, action: true, content: true, toStatus: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.changeRequest.findMany({
      where: { deletedAt: null },
      select: {
        id: true, sequence: true, title: true, type: true, priority: true, status: true, dueAt: true, updatedAt: true,
        owner: { select: { username: true, displayName: true } },
        workOrder: { select: { code: true, specification: true, customerName: true } },
        activities: {
          select: { id: true, action: true, content: true, toStatus: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        planOrder: { deletedAt: null },
        ...(productionTaskScopeWhere ? { dailyProcessTasks: productionTaskScopeWhere } : {}),
      },
      select: {
        id: true,
        batchNo: true,
        quantity: true,
        weekStartDate: true,
        weekEndDate: true,
        plannedCompletionDate: true,
        releaseState: true,
        workOrderId: true,
        productTimeProfileVersion: true,
        unitMillisecondsSnapshot: true,
        releasedAt: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
        carryovers: {
          where: {
            targetWeekStartDate: productionCarryoverDayWindow(currentWeek.start),
            status: 'ACTIVE',
          },
          select: {
            id: true,
            sourceWeekStartDate: true,
            targetWeekStartDate: true,
            inclusionType: true,
          },
          take: 1,
        },
        planOrder: {
          select: {
            id: true,
            customerName: true,
            salesperson: true,
            productName: true,
            specification: true,
            drawingLibraryItemId: true,
            planningUnitMilliseconds: true,
            priority: true,
            remark: true,
            drawingLibraryItem: {
              select: {
                files: {
                  where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } },
                  select: { category: { select: { code: true } } },
                },
                productTimeProfiles: {
                  where: { status: 'published' },
                  orderBy: { version: 'desc' },
                  take: 1,
                  select: {
                    version: true,
                    entries: {
                      orderBy: { position: 'asc' },
                      select: {
                        id: true,
                        position: true,
                        sequenceGroup: true,
                        unitMilliseconds: true,
                        unitLabel: true,
                        reportQuantityBasis: true,
                        reportUnitLabel: true,
                        remark: true,
                        processDefinition: { select: { name: true, stageGroup: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        changes: {
          select: {
            id: true,
            action: true,
            reason: true,
            createdAt: true,
            actor: { select: { username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
        workOrder: {
          select: {
            id: true,
            code: true,
            stage: true,
            status: true,
            priority: true,
            productionOwner: true,
            remark: true,
            progress: true,
            startedAt: true,
            completedAt: true,
            lastProgressAt: true,
            completedQty: true,
            uncompletedQty: true,
            productionTargetQty: true,
            frontendTransferredQty: true,
            branchType: true,
            planActive: true,
            planClearedAt: true,
            updatedAt: true,
            progressLogs: {
              select: { id: true, stage: true, remark: true, createdBy: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 8,
            },
            materialTask: {
              select: {
                status: true,
                completedAt: true,
                activities: {
                  select: {
                    id: true,
                    action: true,
                    content: true,
                    createdAt: true,
                    actor: { select: { username: true, displayName: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 8,
                },
              },
            },
            processRoute: {
              select: {
                id: true,
                status: true,
                version: true,
                templateName: true,
                templateVersion: true,
                productTimeProfileVersion: true,
                routeSource: true,
                confirmedAt: true,
                startedAt: true,
                completedAt: true,
                productTimeProfile: { select: { remark: true } },
                processRouteChanges: {
                  where: {
                    status: 'ACTIVE',
                    activatedRouteVersion: { not: null },
                    diffs: { some: { kind: 'UPDATE_TIME' } },
                  },
                  orderBy: [{ activatedRouteVersion: 'desc' }, { activatedAt: 'desc' }],
                  select: {
                    id: true,
                    activatedRouteVersion: true,
                    diffs: {
                      where: { kind: 'UPDATE_TIME' },
                      select: { kind: true, targetStepId: true, beforeData: true },
                    },
                  },
                },
                steps: {
                  where: { retiredAt: null },
                  select: {
                    id: true,
                    processName: true,
                    status: true,
                    position: true,
                    sequenceGroup: true,
                    stageGroup: true,
                    unitLabel: true,
                    reportQuantityBasis: true,
                    reportUnitLabel: true,
                    standardMillisecondsPerUnit: true,
                    executionMode: true,
                    isCritical: true,
                    changeSource: true,
                    inputQty: true,
                    processedQty: true,
                    goodOutputQty: true,
                    defectOutputQty: true,
                    releasedGoodQty: true,
                    startedAt: true,
                    completedAt: true,
                    remark: true,
                    _count: { select: { executions: true, completions: true } },
                    productTimeEntry: { select: { remark: true } },
                    productTimeDeploymentRoute: {
                      select: {
                        id: true,
                        status: true,
                        routeVersionAfter: true,
                        result: true,
                        deployment: { select: { id: true, status: true } },
                      },
                    },
                    supplementObligation: {
                      select: {
                        requiredQty: true,
                        systemCoveredQty: true,
                        reportedQty: true,
                        status: true,
                        fulfillmentMode: true,
                        releasePolicy: true,
                        isCritical: true,
                      },
                    },
                    executions: {
                      where: {
                        voidedAt: null,
                        ...(filters.laborEmployeeTeam
                          ? { employee: { team: filters.laborEmployeeTeam } }
                          : {}),
                      },
                      select: { goodQty: true, endedAt: true, employee: { select: { name: true } } },
                      orderBy: { endedAt: 'desc' },
                    },
                    completions: {
                      where: { voidedAt: null },
                      select: {
                        id: true,
                        workDate: true,
                        completedAt: true,
                        processedQty: true,
                        goodQty: true,
                        defectQty: true,
                        reportedUnitQty: true,
                        reportedGoodUnitQty: true,
                        reportedDefectUnitQty: true,
                        reportQuantityBasis: true,
                        reportUnitLabel: true,
                        reportMode: true,
                        coverageStatus: true,
                        coveredQty: true,
                        standardMillisecondsPerUnit: true,
                        standardSource: true,
                        participants: {
                          select: { employee: { select: { name: true } } },
                          orderBy: { position: 'asc' },
                        },
                        laborPool: { select: { id: true, claimedQty: true } },
                      },
                      orderBy: { completedAt: 'desc' },
                    },
                    processLaborPools: {
                      where: { status: { not: 'VOIDED' } },
                      select: {
                        id: true,
                        workDate: true,
                        eligibleQty: true,
                        claimedQty: true,
                        remainingQty: true,
                        status: true,
                        standardSource: true,
                        createdAt: true,
                        claims: {
                          where: {
                            status: 'ACTIVE',
                            ...(filters.laborEmployeeTeam
                              ? { employee: { team: filters.laborEmployeeTeam } }
                              : {}),
                          },
                          select: {
                            claimedAt: true,
                            employee: { select: { name: true } },
                          },
                          orderBy: { claimedAt: 'desc' },
                        },
                      },
                      orderBy: { createdAt: 'asc' },
                    },
                  },
                  orderBy: { position: 'asc' },
                },
                activities: {
                  select: {
                    id: true,
                    action: true,
                    content: true,
                    createdAt: true,
                    actor: { select: { username: true, displayName: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 8,
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    }),
    prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        planActive: true,
        productionPlanBatch: null,
        ...(productionTaskScopeWhere ? { dailyProcessTasks: productionTaskScopeWhere } : {}),
      },
      select: {
        id: true, code: true, specification: true, customerName: true, productName: true, priority: true, stage: true,
        status: true, plannedAt: true, deliveryDay: true, updatedAt: true, productionOwner: true, remark: true,
        progress: true, startedAt: true, lastProgressAt: true, frontendTransferredQty: true, branchType: true,
        planActive: true, planClearedAt: true,
        productionTargetQty: true, uncompletedQty: true, completedQty: true,
        weekStartDate: true, weekEndDate: true, drawingLibraryItemId: true, completedAt: true,
        drawingLibraryItem: {
          select: {
            productTimeProfiles: {
              where: { status: 'published' },
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                version: true,
                entries: {
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    position: true,
                    sequenceGroup: true,
                    unitMilliseconds: true,
                    unitLabel: true,
                    reportQuantityBasis: true,
                    reportUnitLabel: true,
                    remark: true,
                    processDefinition: { select: { name: true, stageGroup: true } },
                  },
                },
              },
            },
          },
        },
        progressLogs: {
          select: { id: true, stage: true, remark: true, createdBy: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 8,
        },
        processRoute: {
          select: {
            id: true,
            status: true,
            version: true,
            templateName: true,
            templateVersion: true,
            productTimeProfileVersion: true,
            routeSource: true,
            confirmedAt: true,
            startedAt: true,
            completedAt: true,
            productTimeProfile: { select: { remark: true } },
            processRouteChanges: {
              where: {
                status: 'ACTIVE',
                activatedRouteVersion: { not: null },
                diffs: { some: { kind: 'UPDATE_TIME' } },
              },
              orderBy: [{ activatedRouteVersion: 'desc' }, { activatedAt: 'desc' }],
              select: {
                id: true,
                activatedRouteVersion: true,
                diffs: {
                  where: { kind: 'UPDATE_TIME' },
                  select: { kind: true, targetStepId: true, beforeData: true },
                },
              },
            },
            steps: {
              where: { retiredAt: null },
              select: {
                id: true,
                processName: true,
                status: true,
                position: true,
                sequenceGroup: true,
                stageGroup: true,
                unitLabel: true,
                reportQuantityBasis: true,
                reportUnitLabel: true,
                standardMillisecondsPerUnit: true,
                executionMode: true,
                isCritical: true,
                changeSource: true,
                inputQty: true,
                processedQty: true,
                goodOutputQty: true,
                defectOutputQty: true,
                releasedGoodQty: true,
                startedAt: true,
                completedAt: true,
                remark: true,
                _count: { select: { executions: true, completions: true } },
                productTimeEntry: { select: { remark: true } },
                productTimeDeploymentRoute: {
                  select: {
                    id: true,
                    status: true,
                    routeVersionAfter: true,
                    result: true,
                    deployment: { select: { id: true, status: true } },
                  },
                },
                supplementObligation: {
                  select: {
                    requiredQty: true,
                    systemCoveredQty: true,
                    reportedQty: true,
                    status: true,
                    fulfillmentMode: true,
                    releasePolicy: true,
                    isCritical: true,
                  },
                },
                executions: {
                  where: {
                    voidedAt: null,
                    ...(filters.laborEmployeeTeam
                      ? { employee: { team: filters.laborEmployeeTeam } }
                      : {}),
                  },
                  select: { goodQty: true, endedAt: true, employee: { select: { name: true } } },
                  orderBy: { endedAt: 'desc' },
                },
                completions: {
                  where: { voidedAt: null },
                  select: {
                    id: true,
                    workDate: true,
                    completedAt: true,
                    processedQty: true,
                    goodQty: true,
                    defectQty: true,
                    reportedUnitQty: true,
                    reportedGoodUnitQty: true,
                    reportedDefectUnitQty: true,
                    reportQuantityBasis: true,
                    reportUnitLabel: true,
                    reportMode: true,
                    coverageStatus: true,
                    coveredQty: true,
                    standardMillisecondsPerUnit: true,
                    standardSource: true,
                    participants: {
                      select: { employee: { select: { name: true } } },
                      orderBy: { position: 'asc' },
                    },
                    laborPool: { select: { id: true, claimedQty: true } },
                  },
                  orderBy: { completedAt: 'desc' },
                },
                processLaborPools: {
                  where: { status: { not: 'VOIDED' } },
                  select: {
                    id: true,
                    workDate: true,
                    eligibleQty: true,
                    claimedQty: true,
                    remainingQty: true,
                    status: true,
                    standardSource: true,
                    createdAt: true,
                    claims: {
                      where: {
                        status: 'ACTIVE',
                        ...(filters.laborEmployeeTeam
                          ? { employee: { team: filters.laborEmployeeTeam } }
                          : {}),
                      },
                      select: {
                        claimedAt: true,
                        employee: { select: { name: true } },
                      },
                      orderBy: { claimedAt: 'desc' },
                    },
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
              orderBy: { position: 'asc' },
            },
            activities: {
              select: {
                id: true,
                action: true,
                content: true,
                createdAt: true,
                actor: { select: { username: true, displayName: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 8,
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);

  const issueLabels = ['待受理', '处理中', '待验证', '待发起人确认', '已关闭'];
  const changeLabels = ['草稿', '待评估', '执行中', '待验证', '已关闭'];
  const items: WorkflowItemDTO[] = [];

  for (const issue of issues) {
    const status = issue.status as IssueStatus;
    const approval = issue.majorApprovals[0] || null;
    const majorLabels = ['待受理', '整改处理中', '质量二次复核', '总经办终审', '待发起人确认', '已审批关闭'];
    const majorIndex = status === 'pending'
      ? 0
      : status === 'processing'
        ? 1
        : status === 'closed'
          ? 5
          : status === 'awaiting_confirmation'
            ? 4
          : approval?.status === 'PENDING_GM_APPROVAL'
            ? 3
            : 2;
    const index = issue.isMajorQuality
      ? majorIndex
      : Math.max(0, ['pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'].indexOf(status));
    const closed = status === 'closed';
    const dueAt = issue.dueAt?.toISOString() || null;
    const labels = issue.isMajorQuality ? majorLabels : issueLabels;
    const currentStep = issue.isMajorQuality ? labels[index] : issueStatusLabels[status];
    items.push({
      id: `issue:${issue.id}`, entityId: issue.id, entityType: 'issue', code: issueCode(issue.sequence), title: issue.title,
      subtitle: `${issue.isMajorQuality ? '重大质量事项' : issueTypeLabels[issue.type as IssueType]} · ${issue.workOrder?.specification || issue.workOrder?.code || '未关联工单'}`,
      processStatus: processStatus(status, 'issue'), currentStep, nextStep: nextLabel(labels, index),
      priority: issue.priority as WorkflowItemDTO['priority'], owner: issue.assigneeEmployee?.name || issue.assignee?.displayName || issue.assignee?.username || null,
      dueAt, updatedAt: issue.updatedAt.toISOString(), route: issue.isMajorQuality && approval && status === 'verifying'
        ? `/workspace/approvals?approvalId=${encodeURIComponent(approval.id)}`
        : `/workspace/issues?issueId=${encodeURIComponent(issue.id)}`,
      sourceRoute: null, isOverdue: !closed && !!issue.dueAt && issue.dueAt.getTime() < now,
      steps: steps(labels, index, closed),
      activities: issue.activities.map(item => activity(item.id, item.action, item.content || (item.toStatus ? `流转到${issueStatusLabels[item.toStatus as IssueStatus] || item.toStatus}` : '更新问题'), item.actor?.displayName || item.actor?.username, item.createdAt)),
    });
  }

  for (const change of changes) {
    const status = change.status as ChangeStatus;
    const index = Math.max(0, ['draft', 'assessing', 'implementing', 'verifying', 'closed'].indexOf(status));
    const closed = status === 'closed';
    const dueAt = change.dueAt?.toISOString() || null;
    items.push({
      id: `change:${change.id}`, entityId: change.id, entityType: 'change', code: changeCode(change.sequence), title: change.title,
      subtitle: `${changeTypeLabels[change.type as ChangeType]} · ${change.workOrder?.specification || change.workOrder?.code || '未关联工单'}`,
      processStatus: processStatus(status, 'change'), currentStep: changeStatusLabels[status], nextStep: nextLabel(changeLabels, index),
      priority: change.priority as WorkflowItemDTO['priority'], owner: change.owner?.displayName || change.owner?.username || null,
      dueAt, updatedAt: change.updatedAt.toISOString(), route: `/workspace/changes?changeId=${encodeURIComponent(change.id)}`,
      sourceRoute: null, isOverdue: !closed && !!change.dueAt && change.dueAt.getTime() < now,
      steps: steps(changeLabels, index, closed),
      activities: change.activities.map(item => activity(item.id, item.action, item.content || (item.toStatus ? `流转到${changeStatusLabels[item.toStatus as ChangeStatus] || item.toStatus}` : '更新变更'), item.actor?.displayName || item.actor?.username, item.createdAt)),
    });
  }

  for (const batch of productionBatches) {
    const order = batch.planOrder;
    const workOrder = batch.workOrder;
    const currentCarryover = batch.carryovers[0] || null;
    const warehouseStatus = (workOrder?.materialTask?.status || 'not_created') as WarehouseMaterialStatus | 'not_created';
    const processRouteStatus = (workOrder?.processRoute?.status || 'not_created') as ProcessRouteStatus | 'not_created';
    const currentProcess = workOrder?.processRoute?.steps.find(step => step.status === 'current')
      || workOrder?.processRoute?.steps.find(step => step.status === 'pending')
      || [...(workOrder?.processRoute?.steps || [])].reverse().find(step => step.status === 'completed')
      || null;
    const publishedProfile = order.drawingLibraryItem?.productTimeProfiles[0] || null;
    const productTimeLink = productTimeRouteLink(workOrder, publishedProfile?.version || null);
    const effectiveUnitMilliseconds = batch.unitMillisecondsSnapshot
      || (publishedProfile ? productTimeTotalMilliseconds(publishedProfile.entries) : null)
      || order.planningUnitMilliseconds;
    const resourceCodes = new Set(order.drawingLibraryItem?.files.map(file => file.category.code) || []);
    const facts = {
      releaseState: batch.releaseState as ProductionPlanReleaseState,
      drawingReady: resourceCodes.has('drawing'),
      sopReady: resourceCodes.has('sop'),
      timeReady: Boolean(effectiveUnitMilliseconds),
      warehouseStatus,
      processStatus: processRouteStatus,
      currentProcessName: currentProcess?.processName || null,
      workOrderStartedAt: workOrder?.startedAt || null,
      workOrderCompletedAt: workOrder?.completedAt || null,
      processCompletedAt: workOrder?.processRoute?.completedAt || null,
    };
    const flow = resolvePlanningFlow(facts);
    const reportableRoute = workOrder?.processRoute?.routeSource === 'product_time_profile'
      && workOrder.processRoute.productTimeProfileVersion !== null
      ? workOrder.processRoute
      : null;
    const mappedRouteSteps = reportableRoute
      ? routeSteps(reportableRoute, batch.quantity)
      : [];
    const actualRouteState = reportableRoute && mappedRouteSteps.length > 0
      ? resolveWorkflowRouteState(reportableRoute, mappedRouteSteps, workOrder?.completedAt)
      : null;
    const referenceRoute = actualRouteState
      ? null
      : publishedReferenceRoute(publishedProfile, workOrder);
    const referenceRouteState = referenceRoute
      ? resolveWorkflowRouteState(
          { status: 'in_progress', startedAt: workOrder?.startedAt || workOrder?.lastProgressAt || null },
          referenceRoute.steps,
          workOrder?.completedAt,
        )
      : null;
    const displayedRouteState = actualRouteState || referenceRouteState;
    const preparationSteps = planningFlowStepStates(facts)
      .slice(0, 7)
      .map((state, index): WorkflowStepDTO => ({
        key: `preparation-${index}`,
        label: PLANNING_FLOW_STEPS[index],
        state,
      }));
    const fallbackRoute = productionRouteFallback({
      completed: flow.status === 'completed',
      started: Boolean(
        workOrder?.startedAt
        || workOrder?.processRoute?.startedAt
        || workOrder?.processRoute?.status === 'in_progress',
      ),
    });
    const flowSteps = actualRouteState
      ? mappedRouteSteps
      : referenceRoute?.steps || fallbackRoute.steps;
    const drawingRoute = order.drawingLibraryItemId
      ? `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`
      : `/drawing-library?create=1&customerName=${encodeURIComponent(order.customerName)}&specification=${encodeURIComponent(order.specification)}&productName=${encodeURIComponent(order.productName)}`;
    const productionRoute = workOrder?.id
      ? productionExecutionRouteForWeek(workOrder.id, batch.weekStartDate, nowDate, Boolean(currentCarryover))
      : '';
    let targetRoute = `/weekly-plan-center?batchId=${encodeURIComponent(batch.id)}&week=${encodeURIComponent(chinaDateKey(batch.weekStartDate))}`;
    if ((actualRouteState || referenceRoute) && workOrder?.id) {
      targetRoute = productionRoute;
    } else if (flow.status === 'missing_drawing' || flow.status === 'missing_sop') targetRoute = drawingRoute;
    else if (flow.status === 'missing_time' || flow.status === 'pending_process') {
      targetRoute = productTimeConfigurationRoute(order.drawingLibraryItemId);
    } else if (flow.status === 'material_exception' || flow.status === 'pending_material') {
      targetRoute = `/workspace/warehouse${workOrder?.id ? `?workOrderId=${encodeURIComponent(workOrder.id)}` : ''}`;
    } else if (flow.status === 'production' || flow.status === 'pending_archive' || flow.status === 'completed') {
      targetRoute = workOrder?.id
        ? productionRoute
        : `/production?keyword=${encodeURIComponent(order.specification)}`;
    }
    const batchActivities = batch.changes.map(item => activity(
      item.id,
      item.action,
      item.reason || '更新生产计划批次',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const warehouseActivities = (workOrder?.materialTask?.activities || []).map(item => activity(
      item.id,
      item.action,
      item.content || '更新仓库配料状态',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const processActivities = (workOrder?.processRoute?.activities || []).map(item => activity(
      item.id,
      item.action,
      item.content || '更新产品工艺路线',
      item.actor?.displayName || item.actor?.username,
      item.createdAt,
    ));
    const progressActivities = (workOrder?.progressLogs || []).map(item => activity(
      item.id,
      'production_progress',
      item.remark || '生产状态已更新',
      item.createdBy,
      item.createdAt,
    ));
    const productionActivities = dedupeProductionActivities([
      ...batchActivities,
      ...warehouseActivities,
      ...processActivities,
      ...progressActivities,
    ]).slice(0, 12);
    const closed = displayedRouteState?.closed ?? flow.status === 'completed';
    items.push({
      id: `production-plan:${batch.id}`,
      entityId: batch.id,
      entityType: 'production',
      batchId: batch.id,
      workOrderId: workOrder?.id || null,
      code: order.specification,
      title: order.productName,
      subtitle: `${order.customerName} · 第 ${batch.batchNo} 批 · ${batch.quantity.toLocaleString()} 件`,
      processStatus: displayedRouteState?.processStatus || flow.workflowStatus,
      currentStep: displayedRouteState?.currentStep || fallbackRoute.currentStep,
      nextStep: displayedRouteState?.nextStep ?? fallbackRoute.nextStep,
      priority: order.priority === 'insert' || order.priority === 'urgent'
        ? 'urgent'
        : order.priority === 'high'
          ? 'high'
          : 'normal',
      owner: workOrder?.productionOwner || order.salesperson || null,
      dueAt: batch.plannedCompletionDate.toISOString(),
      updatedAt: new Date(Math.max(batch.updatedAt.getTime(), workOrder?.updatedAt.getTime() || 0)).toISOString(),
      route: targetRoute,
      sourceRoute: drawingRoute,
      isOverdue: !closed && batch.plannedCompletionDate.getTime() < now,
      quantity: batch.quantity,
      weekStartDate: batch.weekStartDate.toISOString(),
      weekEndDate: batch.weekEndDate.toISOString(),
      carryover: currentCarryover ? {
        id: currentCarryover.id,
        sourceWeekStartDate: chinaDateKey(currentCarryover.sourceWeekStartDate),
        targetWeekStartDate: chinaDateKey(currentCarryover.targetWeekStartDate),
        originalWeekStartDate: chinaDateKey(batch.weekStartDate),
        inclusionType: currentCarryover.inclusionType,
      } : null,
      processRouteId: workOrder?.processRoute?.id || null,
      routeVersion: workOrder?.processRoute?.version ?? null,
      routeStatus: (workOrder?.processRoute?.status as ProcessRouteStatus | undefined) || null,
      routeSource: workOrder?.processRoute?.routeSource || null,
      productTimeProfileVersion: workOrder?.processRoute?.productTimeProfileVersion || null,
      availableProductTimeProfileVersion: publishedProfile?.version || null,
      availableProductTimeProcessCount: publishedProfile?.entries.length || null,
      ...productTimeLink,
      routeDisplayMode: actualRouteState ? 'actual' : referenceRoute ? 'published_reference' : 'fallback',
      historicalRouteRepair: referenceRoute?.repair || null,
      productRemark: workOrder?.processRoute?.productTimeProfile?.remark || null,
      orderRemark: workOrder?.remark || order.remark || null,
      drawingLibraryItemId: order.drawingLibraryItemId,
      preparationSteps,
      steps: flowSteps,
      activities: productionActivities,
    });
  }

  for (const order of standaloneProductionOrders) {
    const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
    const quantitySummary = getProductionQuantitySummary(order);
    const targetQuantity = quantitySummary.targetQty;
    const stageClosed = stage === 'completed';
    const dueAt = order.plannedAt?.toISOString() || null;
    const publishedProfile = order.drawingLibraryItem?.productTimeProfiles[0] || null;
    const productTimeLink = productTimeRouteLink(order, publishedProfile?.version || null);
    const reportableRoute = order.processRoute?.routeSource === 'product_time_profile'
      && order.processRoute.productTimeProfileVersion !== null
      ? order.processRoute
      : null;
    const mappedRouteSteps = reportableRoute
      ? routeSteps(reportableRoute, targetQuantity)
      : [];
    const actualRouteState = reportableRoute && mappedRouteSteps.length > 0
      ? resolveWorkflowRouteState(reportableRoute, mappedRouteSteps, order.completedAt)
      : null;
    const referenceRoute = actualRouteState
      ? null
      : publishedReferenceRoute(publishedProfile, order);
    const referenceRouteState = referenceRoute
      ? resolveWorkflowRouteState(
          { status: 'in_progress', startedAt: order.startedAt || order.lastProgressAt || null },
          referenceRoute.steps,
          order.completedAt,
        )
      : null;
    const displayedRouteState = actualRouteState || referenceRouteState;
    const closed = displayedRouteState?.closed ?? stageClosed;
    const fallbackRoute = productionRouteFallback({
      completed: stageClosed,
      started: Boolean(
        order.processRoute?.startedAt
        || order.processRoute?.status === 'in_progress'
        || stage === 'frontend'
        || stage === 'backend',
      ),
    });
    const productionRoute = productionExecutionRouteForWeek(order.id, order.weekStartDate, nowDate);
    const targetRoute = order.processRoute?.routeSource === 'product_time_pending' && !referenceRoute
      ? productTimeConfigurationRoute(order.drawingLibraryItemId)
      : productionRoute;
    items.push({
      id: `production:${order.id}`, entityId: order.id, entityType: 'production', workOrderId: order.id, code: order.specification || order.code,
      title: order.productName, subtitle: `${order.customerName || '客户未设置'} · 内部编号 ${order.code}`,
      processStatus: displayedRouteState?.processStatus || processStatus(stage, 'production'),
      currentStep: displayedRouteState?.currentStep || fallbackRoute.currentStep,
      nextStep: displayedRouteState?.nextStep ?? fallbackRoute.nextStep,
      priority: (order.priority === 'urgent' || order.priority === 'high' ? order.priority : 'normal'), owner: order.productionOwner,
      dueAt, updatedAt: order.updatedAt.toISOString(), route: targetRoute,
      sourceRoute: order.drawingLibraryItemId
        ? `/drawing-library?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`
        : productionRoute,
      isOverdue: !closed && !!order.plannedAt && order.plannedAt.getTime() < now,
      quantity: targetQuantity,
      weekStartDate: order.weekStartDate?.toISOString() || null,
      weekEndDate: order.weekEndDate?.toISOString() || null,
      processRouteId: order.processRoute?.id || null,
      routeVersion: order.processRoute?.version ?? null,
      routeStatus: (order.processRoute?.status as ProcessRouteStatus | undefined) || null,
      routeSource: order.processRoute?.routeSource || null,
      productTimeProfileVersion: order.processRoute?.productTimeProfileVersion ?? null,
      availableProductTimeProfileVersion: publishedProfile?.version || null,
      availableProductTimeProcessCount: publishedProfile?.entries.length || null,
      ...productTimeLink,
      routeDisplayMode: actualRouteState ? 'actual' : referenceRoute ? 'published_reference' : 'fallback',
      historicalRouteRepair: referenceRoute?.repair || null,
      productRemark: order.processRoute?.productTimeProfile?.remark || null,
      orderRemark: order.remark || null,
      drawingLibraryItemId: order.drawingLibraryItemId,
      steps: actualRouteState ? mappedRouteSteps : referenceRoute?.steps || fallbackRoute.steps,
      activities: order.processRoute?.activities.length
        ? order.processRoute.activities.map(item => activity(
          item.id,
          item.action,
          item.content || '更新产品工序路线',
          item.actor?.displayName || item.actor?.username,
          item.createdAt,
        ))
        : order.progressLogs.map(item => activity(item.id, 'production_progress', item.remark || '生产状态已更新', item.createdBy, item.createdAt)),
    });
  }

  const weekScope = filters.weekScope || 'current';
  const allowedEntityTypes = new Set<WorkflowEntityType>(
    filters.allowedEntityTypes || ['issue', 'change', 'production'],
  );
  const navigation = workflowWeekNavigationFromBatches(
    allowedEntityTypes.has('production') ? productionBatches : [],
    nowDate,
  );
  const requestedEntityType = filters.entityType || 'all';
  const weekScoped = items.filter(item => {
    if (!allowedEntityTypes.has(item.entityType)) return false;
    if (item.entityType !== 'production') return true;
    // 周视图以计划批次为唯一主线。旧版未关联计划的独立工单仍可通过深链查看，
    // 但不再混入历史周/本周/未来周统计。
    if (!item.batchId) return false;
    return workflowItemMatchesWeekScope(item, weekScope, nowDate, filters.weekStartDate);
  });
  const scopedSummary = summary(weekScoped);
  const scoped = weekScoped.filter(item => workflowEntityTypeMatchesFilter(item.entityType, requestedEntityType));
  const keyword = String(filters.keyword || '').trim().toLocaleLowerCase('zh-CN');
  const filtered = scoped.filter(item => {
    if (filters.status && filters.status !== 'all' && item.processStatus !== filters.status) return false;
    if (filters.overdue && !item.isOverdue) return false;
    if (keyword && !`${item.code} ${item.title} ${item.subtitle} ${item.owner || ''}`.toLocaleLowerCase('zh-CN').includes(keyword)) return false;
    return true;
  });
  const priorityRank = { urgent: 0, high: 1, normal: 2 } as const;
  filtered.sort((first, second) => Number(second.isOverdue) - Number(first.isOverdue)
    || Number(first.processStatus === 'closed') - Number(second.processStatus === 'closed')
    || priorityRank[first.priority] - priorityRank[second.priority]
    || new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime());
  const target = items.find(item => allowedEntityTypes.has(item.entityType) && (
    (filters.batchId && item.batchId === filters.batchId)
    || (filters.workOrderId && item.workOrderId === filters.workOrderId)
  ));
  const result = target
    ? [target, ...filtered.filter(item => item.id !== target.id)]
    : filtered;
  return {
    items: result.slice(0, 300),
    summary: scopedSummary,
    templates: workflowTemplates.filter(template => allowedEntityTypes.has(template.key)),
    navigation,
  };
}
