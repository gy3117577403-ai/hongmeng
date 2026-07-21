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
import { legacyStatusForStage, normalizeWorkOrderStage } from '@/lib/work-orders';

export const PROCESS_STAGE_GROUPS: ProcessStageGroup[] = ['frontend', 'backend', 'finish'];
export const PROCESS_ROUTE_STATUSES: ProcessRouteStatus[] = ['draft', 'confirmed', 'in_progress', 'completed'];
export const PROCESS_STEP_STATUSES: ProcessStepStatus[] = ['pending', 'current', 'completed', 'skipped'];
export const PRODUCT_TIME_PENDING_ROUTE_SOURCE = 'product_time_pending';
export const PRODUCT_TIME_PENDING_ROUTE_NAME = '产品工序与工时待发布';

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
      _count: { select: { executions: true } },
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
      _count: { select: { executions: true } },
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
  startedAt: Date | string | null;
  steps: Array<{
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    _count: { executions: number };
  }>;
};

const draftRouteSyncInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  workOrder: {
    select: {
      id: true,
      stage: true,
      status: true,
      specification: true,
      drawingLibraryItemId: true,
    },
  },
  steps: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      _count: { select: { executions: true } },
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
    const reportedGoodQuantity = 'executions' in step
      ? step.executions.reduce((total, execution) => total + execution.goodQty, 0)
      : 0;
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
      executionCount: '_count' in step ? step._count.executions : 0,
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

function productTimeRouteSteps(profile: ProductTimeProfileRecord, currentStartedAt?: Date) {
  const firstSequenceGroup = profile.entries[0]?.sequenceGroup;
  return profile.entries.map(entry => ({
    processDefinitionId: entry.processDefinitionId,
    processCode: entry.processDefinition.code,
    processName: entry.processDefinition.name,
    stageGroup: entry.processDefinition.stageGroup,
    position: entry.position,
    sequenceGroup: entry.sequenceGroup,
    ...productTimeStandardSnapshot(profile, entry),
    status: currentStartedAt && entry.sequenceGroup === firstSequenceGroup ? 'current' : 'pending',
    startedAt: currentStartedAt && entry.sequenceGroup === firstSequenceGroup ? currentStartedAt : null,
  }));
}

async function applyPublishedProductTimeToDraftRoute(
  tx: Prisma.TransactionClient,
  input: {
    route: DraftRouteSyncRecord;
    profile: ProductTimeProfileRecord;
    actorId?: string | null;
    activityContent: string;
  },
): Promise<{ updated: boolean; started: boolean }> {
  if (!canReplaceDraftRouteWithProductTime(input.route)) return { updated: false, started: false };
  const activation = productTimeRouteActivation(input.route.workOrder.stage, input.route.workOrder.status);
  const firstDefinition = input.profile.entries[0]?.processDefinition;
  if (!activation || !firstDefinition) return { updated: false, started: false };

  const now = new Date();
  const shouldStart = activation.shouldStart;
  const firstSequenceGroup = input.profile.entries[0].sequenceGroup;
  const firstGroupEntries = input.profile.entries.filter(entry => entry.sequenceGroup === firstSequenceGroup);
  const update = await tx.workOrderProcessRoute.updateMany({
    where: { id: input.route.id, version: input.route.version, status: 'draft' },
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
    data: productTimeRouteSteps(input.profile, shouldStart ? now : undefined).map(step => ({
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
      const result = await applyPublishedProductTimeToDraftRoute(tx, {
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
    if (productProfile && canReplaceDraftRouteWithProductTime(existing)) {
      await applyPublishedProductTimeToDraftRoute(tx, {
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
        steps: { create: productTimeRouteSteps(productProfile, shouldStart && confirmedAt ? confirmedAt : undefined) },
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

export async function syncDraftRoutesFromPublishedProductTime(
  tx: Prisma.TransactionClient,
  input: { profileId: string; actorId: string },
): Promise<{ updated: number; started: number; skipped: number }> {
  const profile = await tx.productTimeProfile.findUnique({
    where: { id: input.profileId },
    include: productTimeProfileInclude,
  });
  if (!profile || profile.status !== 'published') return { updated: 0, started: 0, skipped: 0 };

  const routes = await tx.workOrderProcessRoute.findMany({
    where: {
      status: 'draft',
      workOrder: { drawingLibraryItemId: profile.drawingLibraryItemId },
    },
    include: draftRouteSyncInclude,
  });
  let updated = 0;
  let started = 0;
  let skipped = 0;

  for (const route of routes) {
    const result = await applyPublishedProductTimeToDraftRoute(tx, {
      route,
      profile,
      actorId: input.actorId,
      activityContent: `产品工序与工时 V${profile.version} 已发布，自动替换旧草稿并确认`,
    });
    if (!result.updated) {
      skipped += 1;
      continue;
    }
    updated += 1;
    if (result.started) started += 1;
  }
  return { updated, started, skipped };
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
