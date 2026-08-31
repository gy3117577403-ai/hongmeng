import { Prisma } from '@prisma/client';
import { sanitizeSnapshotValue, workOrderSnapshot } from '@/lib/change-snapshots';
import { prisma } from '@/lib/prisma';
import { ProductionControlError } from '@/lib/production-control';
import { assertProductionMayRun } from '@/lib/production-pause-guard';
import {
  normalizeProcessStageGroup,
  processRouteInclude,
  processStageForGroup,
  resolveCompletedProcessGroupTransition,
  validateProcessSteps,
  type ProcessStepInput,
} from '@/lib/process-routing';
import { processRouteExecutionReadiness } from '@/lib/process-route-readiness';
import { resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';
import {
  calculateActualLaborMilliseconds,
  calculateAttainmentBasisPoints,
  calculateProcessReportProgress,
  calculateProductProcessLaborMilliseconds,
  calculateStandardLaborMilliseconds,
  cleanProcessText,
  nonnegativeInteger,
  parseProcessTimeBasis,
  positiveInteger,
} from '@/lib/process-time';
import { legacyProcessStandardSnapshot, productTimeProfileInclude, productTimeStandardSnapshot } from '@/lib/product-time';
import { isExecutableProductionWorkOrder, legacyStatusForStage, normalizeWorkOrderStage, type WorkOrderStage } from '@/lib/work-orders';
import { productionEmployeeWhere } from '@/lib/production-workforce';

export class ProcessRouteServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PROCESS_ROUTE_INVALID') {
    super(message);
    this.name = 'ProcessRouteServiceError';
    this.status = status;
    this.code = code;
  }
}

type ProcessRouteCommandBase = {
  routeId: string;
  expectedVersion: unknown;
  userId: string;
  actor: string;
};

export type ReplaceProcessRouteStepsCommand = ProcessRouteCommandBase & {
  action: 'replace_steps';
  steps: unknown;
};

export type ConfirmProcessRouteCommand = ProcessRouteCommandBase & {
  action: 'confirm';
};

export type ApplyProductTimeProfileCommand = ProcessRouteCommandBase & {
  action: 'apply_product_time';
};

export type AdvanceProcessRouteCommand = ProcessRouteCommandBase & {
  action: 'advance';
  stepId?: unknown;
  remark?: unknown;
  execution?: unknown;
};

export type ProcessRouteCommand =
  | ReplaceProcessRouteStepsCommand
  | ApplyProductTimeProfileCommand
  | ConfirmProcessRouteCommand
  | AdvanceProcessRouteCommand;

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function parseVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ProcessRouteServiceError('工艺路线版本不正确，请刷新后重试', 400, 'INVALID_PROCESS_ROUTE_VERSION');
  }
  return parsed;
}

function conflict(): ProcessRouteServiceError {
  return new ProcessRouteServiceError(
    '工艺路线已被其他账号更新，请刷新后重试',
    409,
    'PROCESS_ROUTE_VERSION_CONFLICT',
  );
}

function ensureExecutableWeeklyOrder(order: {
  planType: string | null;
  planClearedAt: Date | null;
}): void {
  if (!isExecutableProductionWorkOrder(order)) {
    throw new ProcessRouteServiceError(
      '已归档或已清除的周计划不能维护工艺路线',
      409,
      'WORK_ORDER_READ_ONLY',
    );
  }
}

function targetQuantity(order: Parameters<typeof resolveEffectiveFrontendTransferredQty>[0]): number {
  const resolution = resolveEffectiveFrontendTransferredQty(order);
  if (!resolution.ok || resolution.state.targetQty <= 0) {
    throw new ProcessRouteServiceError('请先补充有效的生产目标数量', 409, 'TARGET_QUANTITY_REQUIRED');
  }
  return resolution.state.targetQty;
}

function normalizeServiceError(error: unknown): ProcessRouteServiceError {
  if (error instanceof ProductionControlError) return new ProcessRouteServiceError(error.message, error.status, error.code);
  if (error instanceof ProcessRouteServiceError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return conflict();
  if (error instanceof Error && (
    error.message.includes('必须')
    || error.message.includes('不能')
    || error.message.includes('超出允许范围')
  )) {
    return new ProcessRouteServiceError(error.message, 400, 'PROCESS_EXECUTION_INVALID');
  }
  return new ProcessRouteServiceError('工艺路线更新失败', 500, 'PROCESS_ROUTE_UPDATE_FAILED');
}

type ProcessExecutionInput = {
  employeeId?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  breakMilliseconds?: unknown;
  goodQty?: unknown;
  scrapQty?: unknown;
  reworkQty?: unknown;
  remark?: unknown;
};

function executionInput(value: unknown): ProcessExecutionInput | null {
  return value && typeof value === 'object' ? value as ProcessExecutionInput : null;
}

function parseExecutionDate(value: unknown, label: string): Date {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    throw new ProcessRouteServiceError(`${label}不正确`, 400, 'PROCESS_EXECUTION_DATE_INVALID');
  }
  return date;
}

async function replaceSteps(input: ReplaceProcessRouteStepsCommand): Promise<string> {
  const validation = validateProcessSteps(input.steps);
  if (!validation.ok) throw new ProcessRouteServiceError(validation.error);

  return prisma.$transaction(async tx => {
    const route = await tx.workOrderProcessRoute.findUnique({
      where: { id: input.routeId },
      include: { workOrder: true },
    });
    if (!route) throw new ProcessRouteServiceError('工艺路线不存在', 404, 'PROCESS_ROUTE_NOT_FOUND');
    ensureExecutableWeeklyOrder(route.workOrder);
    if (route.status !== 'draft') {
      throw new ProcessRouteServiceError('已确认或已开始的工艺路线不能重新编排', 409, 'PROCESS_ROUTE_LOCKED');
    }
    if (route.version !== parseVersion(input.expectedVersion)) throw conflict();

    const definitionIds = validation.steps
      .map(step => step.processDefinitionId)
      .filter((id): id is string => Boolean(id));
    const existingDefinitions = definitionIds.length
      ? await tx.processDefinition.findMany({
          where: { id: { in: definitionIds }, isActive: true },
          include: { timeStandards: { where: { isCurrent: true }, take: 1 } },
        })
      : [];
    const definitionSet = new Set(existingDefinitions.map(item => item.id));
    const standardMap = new Map(existingDefinitions.map(item => [item.id, item.timeStandards[0] || null]));
    const productProfile = route.productTimeProfileId
      ? await tx.productTimeProfile.findUnique({
          where: { id: route.productTimeProfileId },
          include: productTimeProfileInclude,
        })
      : route.workOrder.drawingLibraryItemId
        ? await tx.productTimeProfile.findFirst({
            where: { drawingLibraryItemId: route.workOrder.drawingLibraryItemId, status: 'published' },
            include: productTimeProfileInclude,
            orderBy: { version: 'desc' },
          })
        : null;
    const claimedProductEntryIds = new Set<string>();
    const steps = validation.steps.map(step => ({
      ...step,
      processDefinitionId: step.processDefinitionId && definitionSet.has(step.processDefinitionId)
        ? step.processDefinitionId
        : null,
    }));

    const update = await tx.workOrderProcessRoute.updateMany({
      where: { id: route.id, version: route.version, status: 'draft' },
      data: {
        version: { increment: 1 },
        productTimeProfileId: productProfile?.id || route.productTimeProfileId,
        productTimeProfileVersion: productProfile?.version || route.productTimeProfileVersion,
        routeSource: productProfile ? 'product_time_profile' : route.routeSource,
      },
    });
    if (update.count !== 1) throw conflict();
    await tx.workOrderProcessStep.deleteMany({ where: { routeId: route.id } });
    await tx.workOrderProcessStep.createMany({
      data: steps.map(step => {
        const productEntry = step.processDefinitionId
          ? (productProfile?.entries || []).find(entry => (
              !claimedProductEntryIds.has(entry.id)
              && entry.processDefinitionId === step.processDefinitionId
              && entry.position === step.position
              && entry.sequenceGroup === step.sequenceGroup
            )) || (productProfile?.entries || []).find(entry => (
              !claimedProductEntryIds.has(entry.id)
              && entry.processDefinitionId === step.processDefinitionId
            ))
          : null;
        if (productEntry) claimedProductEntryIds.add(productEntry.id);
        const standard = step.processDefinitionId ? standardMap.get(step.processDefinitionId) : null;
        return {
          routeId: route.id,
          processDefinitionId: step.processDefinitionId,
          processCode: step.processCode,
          processName: step.processName,
          stageGroup: step.stageGroup,
          position: step.position,
          sequenceGroup: step.sequenceGroup,
          ...(productProfile && productEntry
            ? productTimeStandardSnapshot(productProfile, productEntry)
            : !productProfile && standard
              ? legacyProcessStandardSnapshot(standard, step.unitsPerProduct)
              : {
                  unitsPerProduct: step.unitsPerProduct,
                  standardTimeId: null,
                  standardVersion: null,
                  productTimeProfileId: productProfile?.id || null,
                  productTimeEntryId: null,
                  productTimeProfileVersion: productProfile?.version || null,
                  standardSource: 'missing',
                  timeBasis: null,
                  unitLabel: null,
                  standardMillisecondsPerUnit: null,
                  setupMilliseconds: 0,
                  countsForEfficiency: true,
                }),
          status: 'pending',
        };
      }),
    });
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        action: 'update_process_route',
        content: `调整工艺路线，共 ${steps.length} 个工序`,
        actorId: input.userId,
        detail: {
          stepCount: steps.length,
          productTimeProfileId: productProfile?.id || null,
          productTimeProfileVersion: productProfile?.version || null,
        },
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'update_process_route',
        targetType: 'work_order_process_route',
        targetId: route.id,
        detail: { workOrderId: route.workOrderId, stepCount: steps.length },
      },
    });
    return route.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function applyProductTimeProfile(input: ApplyProductTimeProfileCommand): Promise<string> {
  return prisma.$transaction(async tx => {
    const route = await tx.workOrderProcessRoute.findUnique({
      where: { id: input.routeId },
      include: { workOrder: true },
    });
    if (!route) throw new ProcessRouteServiceError('工艺路线不存在', 404, 'PROCESS_ROUTE_NOT_FOUND');
    ensureExecutableWeeklyOrder(route.workOrder);
    if (route.status !== 'draft') {
      throw new ProcessRouteServiceError('已确认或已开始的路线不能切换产品工时', 409, 'PROCESS_ROUTE_LOCKED');
    }
    if (route.version !== parseVersion(input.expectedVersion)) throw conflict();
    if (!route.workOrder.drawingLibraryItemId) {
      throw new ProcessRouteServiceError('当前工单尚未关联图纸资料产品', 409, 'PRODUCT_TIME_ITEM_MISSING');
    }
    const profile = await tx.productTimeProfile.findFirst({
      where: { drawingLibraryItemId: route.workOrder.drawingLibraryItemId, status: 'published' },
      include: productTimeProfileInclude,
      orderBy: { version: 'desc' },
    });
    if (!profile?.entries.length) {
      throw new ProcessRouteServiceError('当前产品没有已发布工时，请先到产品工时维护并发布', 409, 'PRODUCT_TIME_PROFILE_MISSING');
    }
    const update = await tx.workOrderProcessRoute.updateMany({
      where: { id: route.id, version: route.version, status: 'draft' },
      data: {
        templateId: null,
        templateName: `${route.workOrder.specification || '当前产品'} 产品工时`,
        templateVersion: profile.version,
        productTimeProfileId: profile.id,
        productTimeProfileVersion: profile.version,
        routeSource: 'product_time_profile',
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) throw conflict();
    await tx.workOrderProcessStep.deleteMany({ where: { routeId: route.id } });
    await tx.workOrderProcessStep.createMany({
      data: profile.entries.map(entry => ({
        routeId: route.id,
        processDefinitionId: entry.processDefinitionId,
        processCode: entry.processDefinition.code,
        processName: entry.processDefinition.name,
        stageGroup: entry.processDefinition.stageGroup,
        position: entry.position,
        sequenceGroup: entry.sequenceGroup,
        ...productTimeStandardSnapshot(profile, entry),
        status: 'pending',
      })),
    });
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        action: 'apply_product_time_profile',
        content: `应用产品工时 V${profile.version}，共 ${profile.entries.length} 道工序`,
        actorId: input.userId,
        detail: { productTimeProfileId: profile.id, productTimeProfileVersion: profile.version },
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'apply_product_time_profile',
        targetType: 'work_order_process_route',
        targetId: route.id,
        detail: {
          workOrderId: route.workOrderId,
          productTimeProfileId: profile.id,
          productTimeProfileVersion: profile.version,
          processCount: profile.entries.length,
        },
      },
    });
    return route.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function confirmRoute(input: ConfirmProcessRouteCommand): Promise<string> {
  return prisma.$transaction(async tx => {
    const route = await tx.workOrderProcessRoute.findUnique({
      where: { id: input.routeId },
      include: {
        workOrder: { include: { materialTask: { select: { status: true } } } },
        steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
      },
    });
    if (!route) throw new ProcessRouteServiceError('工艺路线不存在', 404, 'PROCESS_ROUTE_NOT_FOUND');
    ensureExecutableWeeklyOrder(route.workOrder);
    if (route.status !== 'draft') {
      throw new ProcessRouteServiceError('该工艺路线已经确认', 409, 'PROCESS_ROUTE_ALREADY_CONFIRMED');
    }
    if (!route.steps.length) throw new ProcessRouteServiceError('工艺路线至少需要一个工序');
    if (route.version !== parseVersion(input.expectedVersion)) throw conflict();

    const now = new Date();
    const definitionIds = route.steps
      .map(step => step.processDefinitionId)
      .filter((id): id is string => Boolean(id));
    const currentStandards = definitionIds.length
      ? await tx.processTimeStandard.findMany({
          where: { processDefinitionId: { in: definitionIds }, isCurrent: true },
        })
      : [];
    const standardMap = new Map(currentStandards.map(standard => [standard.processDefinitionId, standard]));
    const productProfile = route.productTimeProfileId
      ? await tx.productTimeProfile.findUnique({
          where: { id: route.productTimeProfileId },
          include: productTimeProfileInclude,
        })
      : null;
    const productEntryById = new Map((productProfile?.entries || []).map(entry => [entry.id, entry] as const));
    const claimedProductEntryIds = new Set<string>();
    const readinessSteps = [];
    for (const step of route.steps) {
      const linkedProductEntry = step.productTimeEntryId
        ? productEntryById.get(step.productTimeEntryId)
        : null;
      const productEntry = linkedProductEntry
        && linkedProductEntry.processDefinitionId === step.processDefinitionId
        && !claimedProductEntryIds.has(linkedProductEntry.id)
        ? linkedProductEntry
        : step.processDefinitionId
          ? (productProfile?.entries || []).find(entry => (
              !claimedProductEntryIds.has(entry.id)
              && entry.processDefinitionId === step.processDefinitionId
              && entry.position === step.position
              && entry.sequenceGroup === step.sequenceGroup
            )) || (productProfile?.entries || []).find(entry => (
              !claimedProductEntryIds.has(entry.id)
              && entry.processDefinitionId === step.processDefinitionId
            ))
          : null;
      if (productEntry) claimedProductEntryIds.add(productEntry.id);
      const standard = step.processDefinitionId ? standardMap.get(step.processDefinitionId) : null;
      const snapshot = productProfile && productEntry
        ? productTimeStandardSnapshot(productProfile, productEntry)
        : !productProfile && standard
          ? legacyProcessStandardSnapshot(standard, step.unitsPerProduct)
          : null;
      const snapshotData = snapshot || {
        standardTimeId: null,
        standardVersion: null,
        productTimeProfileId: productProfile?.id || null,
        productTimeEntryId: null,
        productTimeProfileVersion: productProfile?.version || null,
        standardSource: 'missing',
        timeBasis: null,
        unitLabel: null,
        standardMillisecondsPerUnit: null,
        setupMilliseconds: 0,
        reportQuantityBasis: 'product',
        reportUnitLabel: step.unitLabel || '件',
        countsForEfficiency: true,
      };
      readinessSteps.push({
        processName: step.processName,
        status: step.status,
        unitsPerProduct: step.unitsPerProduct,
        timeBasis: snapshotData.timeBasis,
        unitLabel: snapshotData.unitLabel,
        standardMillisecondsPerUnit: snapshotData.standardMillisecondsPerUnit,
        setupMilliseconds: snapshotData.setupMilliseconds,
      });
      await tx.workOrderProcessStep.update({
        where: { id: step.id },
        data: snapshotData,
      });
    }
    const stage = normalizeWorkOrderStage(route.workOrder.stage || route.workOrder.status) || 'not_issued';
    const executableSteps = route.steps.filter(step => step.status !== 'skipped');
    const first = executableSteps[0] || route.steps[0];
    const firstSequenceGroup = first.sequenceGroup;
    const firstSteps = executableSteps.filter(step => step.sequenceGroup === firstSequenceGroup);
    const timeReadiness = processRouteExecutionReadiness(readinessSteps);
    // Route confirmation may proceed while material is incomplete, but it must
    // never auto-start on a risk authorization intended for manual execution.
    const shouldStart = stage !== 'not_issued'
      && timeReadiness.ready
      && route.workOrder.materialTask?.status === 'completed';
    const firstGroup = normalizeProcessStageGroup(first.stageGroup) || 'frontend';
    const nextStage = shouldStart ? processStageForGroup(firstGroup) : stage;
    const update = await tx.workOrderProcessRoute.updateMany({
      where: { id: route.id, version: route.version, status: 'draft' },
      data: {
        status: shouldStart ? 'in_progress' : 'confirmed',
        confirmedAt: now,
        confirmedById: input.userId,
        startedAt: shouldStart ? now : null,
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) throw conflict();
    if (shouldStart) {
      const initialInputQty = targetQuantity(route.workOrder);
      await tx.workOrderProcessStep.updateMany({
        where: { routeId: route.id, sequenceGroup: firstSequenceGroup, status: 'pending' },
        data: { status: 'current', startedAt: now, inputQty: initialInputQty, quantityVersion: { increment: 1 } },
      });
      await tx.workOrder.update({
        where: { id: route.workOrderId },
        data: {
          stage: nextStage,
          status: legacyStatusForStage(nextStage),
          startedAt: route.workOrder.startedAt || now,
          latestProgressRemark: `当前工序：${firstSteps.map(step => step.processName).join('、')}`,
          lastProgressAt: now,
        },
      });
    }
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        stepId: shouldStart ? first.id : null,
        action: 'confirm_process_route',
        content: shouldStart
          ? `确认工艺路线，开始 ${firstSteps.map(step => step.processName).join('、')}`
          : stage !== 'not_issued' && !timeReadiness.ready
            ? `确认工艺路线，等待补齐工时：${timeReadiness.missingStepNames.join('、')}`
            : '确认工艺路线，等待开始生产',
        actorId: input.userId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'confirm_process_route',
        targetType: 'work_order_process_route',
        targetId: route.id,
        detail: {
          workOrderId: route.workOrderId,
          stepCount: route.steps.length,
          started: shouldStart,
          timeReady: timeReadiness.ready,
          missingTimeSteps: timeReadiness.missingStepNames,
        },
      },
    });
    return route.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function advanceRoute(input: AdvanceProcessRouteCommand): Promise<string> {
  if (input.action === 'advance') {
    throw new ProcessRouteServiceError(
      '旧转序入口已停用，请使用“完成当前工序并转序”',
      410,
      'PROCESS_COMPLETION_REQUIRED',
    );
  }
  return prisma.$transaction(async tx => {
    const route = await tx.workOrderProcessRoute.findUnique({
      where: { id: input.routeId },
      include: { workOrder: true, steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } } },
    });
    if (!route) throw new ProcessRouteServiceError('工艺路线不存在', 404, 'PROCESS_ROUTE_NOT_FOUND');
    await assertProductionMayRun(tx, route.workOrder.id);
    ensureExecutableWeeklyOrder(route.workOrder);
    if (route.status === 'draft') {
      throw new ProcessRouteServiceError('请先由工艺确认路线后再上报生产进度', 409, 'PROCESS_ROUTE_NOT_CONFIRMED');
    }
    if (route.status === 'completed') {
      throw new ProcessRouteServiceError('该工艺路线已经完成', 409, 'PROCESS_ROUTE_COMPLETED');
    }
    if (route.version !== parseVersion(input.expectedVersion)) throw conflict();
    const stage = normalizeWorkOrderStage(route.workOrder.stage || route.workOrder.status) || 'not_issued';
    if (stage === 'not_issued') {
      throw new ProcessRouteServiceError('请先确认图纸已下发', 409, 'DRAWING_NOT_ISSUED');
    }
    const currentSteps = route.steps.filter(step => step.status === 'current');
    if (!currentSteps.length) {
      throw new ProcessRouteServiceError('当前执行工序状态异常，请检查并重新发布该产品工序与工时', 409, 'PROCESS_CURRENT_STEP_MISSING');
    }
    const requestedStepId = cleanProcessText(input.stepId, 80);
    const current = requestedStepId
      ? currentSteps.find(step => step.id === requestedStepId)
      : currentSteps[0];
    if (!current) {
      throw new ProcessRouteServiceError('所选工序不是当前可报工工序，请刷新后重试', 409, 'PROCESS_STEP_NOT_CURRENT');
    }
    if (route.routeSource === 'product_time_profile') {
      throw new ProcessRouteServiceError(
        '产品工序已启用“完成并转序 + 工时领取”，请在生产调度中心完成当前工序',
        409,
        'PROCESS_COMPLETION_REQUIRED',
      );
    }
    const now = new Date();
    const remark = cleanText(input.remark, 300);
    const target = targetQuantity(route.workOrder);
    const submittedExecution = executionInput(input.execution);
    if (route.routeSource === 'product_time_profile' && !submittedExecution) {
      throw new ProcessRouteServiceError('请选择员工并填写本次报工数量与时间', 400, 'PROCESS_EXECUTION_REQUIRED');
    }
    const executionTotal = await tx.processExecution.aggregate({
      where: { stepId: current.id, voidedAt: null },
      _sum: { goodQty: true },
    });
    const previouslyReportedGoodQty = executionTotal._sum.goodQty || 0;
    const remainingBeforeReport = Math.max(0, target - previouslyReportedGoodQty);
    let executionId: string | null = null;
    let reportedGoodQty = previouslyReportedGoodQty;
    let resolvedStandard = current.standardMillisecondsPerUnit && current.timeBasis && current.unitLabel
      ? {
          id: current.standardTimeId,
          version: current.standardVersion,
          productTimeProfileId: current.productTimeProfileId,
          productTimeEntryId: current.productTimeEntryId,
          productTimeProfileVersion: current.productTimeProfileVersion,
          standardSource: current.standardSource,
          timeBasis: parseProcessTimeBasis(current.timeBasis),
          unitLabel: current.unitLabel,
          standardMillisecondsPerUnit: current.standardMillisecondsPerUnit,
          setupMilliseconds: current.setupMilliseconds,
          countsForEfficiency: current.countsForEfficiency,
        }
      : null;
    if (!resolvedStandard && route.productTimeProfileId && current.processDefinitionId) {
      const profileEntries = await tx.productProcessTimeEntry.findMany({
        where: {
          profileId: route.productTimeProfileId,
          processDefinitionId: current.processDefinitionId,
        },
        orderBy: { position: 'asc' },
        include: { profile: { select: { id: true, version: true } } },
      });
      const occurrenceIndex = route.steps
        .filter(step => step.processDefinitionId === current.processDefinitionId)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .findIndex(step => step.id === current.id);
      const productEntry = (
        current.productTimeEntryId
          ? profileEntries.find(entry => entry.id === current.productTimeEntryId)
          : null
      ) || profileEntries.find(entry => entry.position === current.position)
        || profileEntries[occurrenceIndex]
        || null;
      if (productEntry) {
        const usesActionCount = productEntry.timeBasis !== 'per_batch'
          && Boolean(productEntry.actionMilliseconds)
          && productEntry.occurrences > 1;
        resolvedStandard = {
          id: null,
          version: null,
          productTimeProfileId: productEntry.profile.id,
          productTimeEntryId: productEntry.id,
          productTimeProfileVersion: productEntry.profile.version,
          standardSource: 'product_profile',
          timeBasis: productEntry.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
          unitLabel: productEntry.unitLabel || '套',
          standardMillisecondsPerUnit: usesActionCount
            ? productEntry.actionMilliseconds as number
            : productEntry.unitMilliseconds,
          setupMilliseconds: productEntry.setupMilliseconds,
          countsForEfficiency: productEntry.countsForEfficiency,
        };
      }
    }
    if (!resolvedStandard && !route.productTimeProfileId && current.processDefinitionId) {
      const standard = await tx.processTimeStandard.findFirst({
        where: { processDefinitionId: current.processDefinitionId, isCurrent: true },
        orderBy: { version: 'desc' },
      });
      if (standard) {
        resolvedStandard = {
          id: standard.id,
          version: standard.version,
          productTimeProfileId: null,
          productTimeEntryId: null,
          productTimeProfileVersion: null,
          standardSource: 'process_standard',
          timeBasis: parseProcessTimeBasis(standard.timeBasis),
          unitLabel: standard.unitLabel,
          standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
          setupMilliseconds: standard.setupMilliseconds,
          countsForEfficiency: standard.countsForEfficiency,
        };
      }
    }
    if (submittedExecution) {
      if (!resolvedStandard) {
        throw new ProcessRouteServiceError(
          '当前工序尚未配置标准工时，请先到标准工时库定标',
          409,
          'PROCESS_STANDARD_REQUIRED',
        );
      }
      const employeeId = cleanProcessText(submittedExecution.employeeId, 80);
      const employee = employeeId
        ? await tx.employee.findFirst({ where: { id: employeeId, ...productionEmployeeWhere() } })
        : null;
      if (!employee) {
        throw new ProcessRouteServiceError('请选择生产部且已启用考勤的在职员工', 400, 'PROCESS_EMPLOYEE_REQUIRED');
      }
      const startedAt = parseExecutionDate(submittedExecution.startedAt, '开始时间');
      const endedAt = parseExecutionDate(submittedExecution.endedAt, '结束时间');
      const breakMilliseconds = nonnegativeInteger(submittedExecution.breakMilliseconds, '暂停时长');
      const goodQty = positiveInteger(submittedExecution.goodQty, '合格数量');
      const scrapQty = nonnegativeInteger(submittedExecution.scrapQty, '报废数量');
      const reworkQty = nonnegativeInteger(submittedExecution.reworkQty, '返工数量');
      if (remainingBeforeReport <= 0) {
        throw new ProcessRouteServiceError('当前工序已完成目标数量，请刷新后继续', 409, 'PROCESS_STEP_ALREADY_REPORTED');
      }
      const reportProgress = (() => {
        try {
          return calculateProcessReportProgress({
            targetQuantity: target,
            previouslyReportedGoodQuantity: previouslyReportedGoodQty,
            submittedGoodQuantity: goodQty,
          });
        } catch (error) {
          throw new ProcessRouteServiceError(
            error instanceof Error ? error.message : '本次报工数量不正确',
            400,
            'PROCESS_EXECUTION_QTY_EXCEEDED',
          );
        }
      })();
      const actualLaborMilliseconds = calculateActualLaborMilliseconds(startedAt, endedAt, breakMilliseconds);
      const productProfileStandard = route.routeSource === 'product_time_profile';
      const standardLaborMilliseconds = productProfileStandard
        ? calculateProductProcessLaborMilliseconds({
            aggregateMillisecondsPerProduct: resolvedStandard.standardMillisecondsPerUnit,
            goodQty,
          })
        : calculateStandardLaborMilliseconds({
            timeBasis: resolvedStandard.timeBasis,
            standardMillisecondsPerUnit: resolvedStandard.standardMillisecondsPerUnit,
            setupMilliseconds: resolvedStandard.setupMilliseconds,
            goodQty,
            unitsPerProduct: current.unitsPerProduct,
          });
      const attainmentBasisPoints = calculateAttainmentBasisPoints(
        standardLaborMilliseconds,
        actualLaborMilliseconds,
      );
      const execution = await tx.processExecution.create({
        data: {
          stepId: current.id,
          employeeId: employee.id,
          startedAt,
          endedAt,
          breakMilliseconds,
          goodQty,
          scrapQty,
          reworkQty,
          timeBasis: productProfileStandard ? 'per_unit' : resolvedStandard.timeBasis,
          unitLabel: productProfileStandard ? '套' : resolvedStandard.unitLabel,
          standardMillisecondsPerUnit: resolvedStandard.standardMillisecondsPerUnit,
          setupMilliseconds: productProfileStandard ? 0 : resolvedStandard.setupMilliseconds,
          unitsPerProduct: productProfileStandard ? 1 : current.unitsPerProduct,
          standardLaborMilliseconds,
          actualLaborMilliseconds,
          attainmentBasisPoints,
          countsForEfficiency: resolvedStandard.countsForEfficiency,
          standardSource: resolvedStandard.standardSource,
          productTimeProfileVersion: resolvedStandard.productTimeProfileVersion,
          source: 'completion_form',
          remark: cleanProcessText(submittedExecution.remark, 300) || null,
          recordedById: input.userId,
        },
      });
      executionId = execution.id;
      reportedGoodQty = reportProgress.reportedGoodQuantity;
    }

    const completesCurrentStep = route.routeSource !== 'product_time_profile' || reportedGoodQty >= target;
    const remainingAfterReport = Math.max(0, target - reportedGoodQty);
    const completedBefore = route.steps.filter(step => step.status === 'completed' || step.status === 'skipped').length;
    const progress = route.steps.length > 0
      ? Math.min(100, Math.round(((completedBefore + (completesCurrentStep ? 1 : reportedGoodQty / target)) / route.steps.length) * 100))
      : 0;
    const routeUpdate = await tx.workOrderProcessRoute.updateMany({
      where: { id: route.id, version: route.version, status: { in: ['confirmed', 'in_progress'] } },
      data: {
        status: completesCurrentStep ? route.status : 'in_progress',
        completedAt: null,
        version: { increment: 1 },
      },
    });
    if (routeUpdate.count !== 1) throw conflict();

    const standardSnapshot = {
      standardTimeId: resolvedStandard?.id ?? current.standardTimeId,
      standardVersion: resolvedStandard?.version ?? current.standardVersion,
      productTimeProfileId: resolvedStandard?.productTimeProfileId ?? current.productTimeProfileId,
      productTimeEntryId: resolvedStandard?.productTimeEntryId ?? current.productTimeEntryId,
      productTimeProfileVersion: resolvedStandard?.productTimeProfileVersion ?? current.productTimeProfileVersion,
      standardSource: resolvedStandard?.standardSource || current.standardSource,
      timeBasis: resolvedStandard?.timeBasis || current.timeBasis,
      unitLabel: route.routeSource === 'product_time_profile' ? '套' : resolvedStandard?.unitLabel || current.unitLabel,
      standardMillisecondsPerUnit: resolvedStandard?.standardMillisecondsPerUnit ?? current.standardMillisecondsPerUnit,
      setupMilliseconds: route.routeSource === 'product_time_profile' ? 0 : resolvedStandard?.setupMilliseconds ?? current.setupMilliseconds,
      unitsPerProduct: route.routeSource === 'product_time_profile' ? 1 : current.unitsPerProduct,
      countsForEfficiency: resolvedStandard?.countsForEfficiency ?? current.countsForEfficiency,
    };

    if (!completesCurrentStep) {
      await tx.workOrderProcessStep.update({
        where: { id: current.id },
        data: {
          ...standardSnapshot,
          startedAt: current.startedAt || now,
          remark: remark || current.remark,
        },
      });
      const nextStage = processStageForGroup(normalizeProcessStageGroup(current.stageGroup) || 'frontend');
      const content = `${current.processName}已报工 ${reportedGoodQty}/${target}，剩余 ${remainingAfterReport}`;
      const changed = await tx.workOrder.update({
        where: { id: route.workOrderId },
        data: {
          stage: nextStage,
          status: legacyStatusForStage(nextStage),
          progress,
          executionVersion: { increment: 1 },
          startedAt: route.workOrder.startedAt || now,
          completedAt: null,
          lastProgressAt: now,
          latestProgressRemark: remark ? `${content}：${remark}` : content,
        },
      });
      await tx.processRouteActivity.create({
        data: {
          routeId: route.id,
          stepId: current.id,
          action: 'record_process_execution',
          content: remark ? `${content}：${remark}` : content,
          actorId: input.userId,
          detail: { processCode: current.processCode, reportedGoodQty, remainingGoodQty: remainingAfterReport, executionId },
        },
      });
      await tx.workOrderProgressLog.create({
        data: {
          workOrderId: route.workOrderId,
          previousStage: stage,
          stage: nextStage,
          completedQty: changed.completedQty,
          productionOwner: changed.productionOwner,
          workstation: changed.workstation,
          remark: remark ? `${content}：${remark}` : content,
          createdBy: input.actor,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: input.userId,
          action: 'record_process_execution',
          targetType: 'work_order_process_step',
          targetId: current.id,
          detail: { workOrderId: route.workOrderId, processCode: current.processCode, reportedGoodQty, remainingGoodQty: remainingAfterReport, executionId },
        },
      });
      await tx.dataChangeSnapshot.create({
        data: {
          entityType: 'work_order',
          entityId: route.workOrderId,
          action: 'record_process_execution',
          beforeJson: sanitizeSnapshotValue(workOrderSnapshot(route.workOrder)),
          afterJson: sanitizeSnapshotValue(workOrderSnapshot(changed)),
          changedBy: input.actor,
        },
      });
      return route.id;
    }

    await tx.workOrderProcessStep.update({
      where: { id: current.id },
      data: {
        status: 'completed',
        completedAt: now,
        completedById: input.userId,
        remark: remark || null,
        ...standardSnapshot,
      },
    });

    const transition = resolveCompletedProcessGroupTransition(route.steps, current.id);
    const groupCompleted = transition.groupCompleted;
    const nextStepIds = new Set(transition.nextStepIds);
    const activeStepIds = new Set(transition.activeStepIds);
    const nextSteps = route.steps.filter(step => nextStepIds.has(step.id));
    if (nextSteps.length) {
      await tx.workOrderProcessStep.updateMany({
        where: { id: { in: nextSteps.map(step => step.id) }, status: 'pending' },
        data: { status: 'current', startedAt: now },
      });
    }

    const activeSteps = route.steps.filter(step => activeStepIds.has(step.id));
    const next = activeSteps[0] || null;
    const routeCompleted = transition.routeCompleted;
    await tx.workOrderProcessRoute.update({
      where: { id: route.id },
      data: { status: routeCompleted ? 'completed' : 'in_progress', completedAt: routeCompleted ? now : null },
    });
    const nextGroup = next ? normalizeProcessStageGroup(next.stageGroup) || 'frontend' : 'finish';
    const nextStage: WorkOrderStage = routeCompleted ? 'completed' : processStageForGroup(nextGroup);
    const transferToBackend = !routeCompleted && nextGroup !== 'frontend';
    const nextNames = activeSteps.map(step => step.processName).join('、');
    const workOrderData: Prisma.WorkOrderUpdateInput = {
      stage: nextStage,
      status: legacyStatusForStage(nextStage),
      progress: routeCompleted ? 100 : progress,
      executionVersion: { increment: 1 },
      startedAt: route.workOrder.startedAt || now,
      completedAt: routeCompleted ? now : null,
      lastProgressAt: now,
      latestProgressRemark: !routeCompleted
        ? `${current.processName}完成，${groupCompleted ? '进入' : '等待并行工序'}${nextNames}${remark ? `：${remark}` : ''}`
        : `${current.processName}完成，工艺路线已结束${remark ? `：${remark}` : ''}`,
    };
    if (route.workOrder.frontendTransferredQty === null) {
      workOrderData.frontendTransferredQty = transferToBackend || routeCompleted ? target : 0;
    } else if (transferToBackend || routeCompleted) {
      workOrderData.frontendTransferredQty = target;
    }
    if (routeCompleted) workOrderData.completedQty = String(target);
    const changed = await tx.workOrder.update({
      where: { id: route.workOrderId },
      data: workOrderData,
    });

    const content = !routeCompleted
      ? `完成 ${current.processName}，${groupCompleted ? '进入' : '等待并行工序'} ${nextNames}`
      : `完成 ${current.processName}，工单生产完成`;
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        stepId: current.id,
        action: 'advance_process_route',
        content: remark ? `${content}：${remark}` : content,
        actorId: input.userId,
        detail: {
          fromStep: current.processCode,
          toSteps: activeSteps.map(step => step.processCode),
          progress: routeCompleted ? 100 : progress,
          reportedGoodQty,
          executionId,
        },
      },
    });
    await tx.workOrderProgressLog.create({
      data: {
        workOrderId: route.workOrderId,
        previousStage: stage,
        stage: nextStage,
        completedQty: changed.completedQty,
        productionOwner: changed.productionOwner,
        workstation: changed.workstation,
        remark: remark ? `${content}：${remark}` : content,
        createdBy: input.actor,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'advance_process_route',
        targetType: 'work_order_process_route',
        targetId: route.id,
        detail: {
          workOrderId: route.workOrderId,
          fromStep: current.processCode,
          toSteps: activeSteps.map(step => step.processCode),
          progress: routeCompleted ? 100 : progress,
          reportedGoodQty,
          executionId,
        },
      },
    });
    await tx.dataChangeSnapshot.create({
      data: {
        entityType: 'work_order',
        entityId: route.workOrderId,
        action: 'advance_process_route',
        beforeJson: sanitizeSnapshotValue(workOrderSnapshot(route.workOrder)),
        afterJson: sanitizeSnapshotValue(workOrderSnapshot(changed)),
        changedBy: input.actor,
      },
    });
    return route.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateProcessRoute(command: ProcessRouteCommand): Promise<string> {
  try {
    if (command.action === 'replace_steps') return await replaceSteps(command);
    if (command.action === 'apply_product_time') return await applyProductTimeProfile(command);
    if (command.action === 'confirm') return await confirmRoute(command);
    return await advanceRoute(command);
  } catch (error) {
    throw normalizeServiceError(error);
  }
}

export async function startConfirmedProcessRoute(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    userId: string | null;
    actor: string;
    now: Date;
    trigger?: 'manual_start' | 'drawing_issued' | 'automatic_plan_release' | 'automatic_plan_reconciliation';
  },
): Promise<boolean> {
  const route = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: input.workOrderId },
    include: {
      workOrder: { include: { materialTask: { select: { status: true } } } },
      steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
    },
  });
  if (!route || route.status !== 'confirmed' || route.startedAt || !route.steps.length) return false;
  if (input.trigger && input.trigger !== 'manual_start' && route.workOrder.materialTask?.status !== 'completed') {
    return false;
  }
  try {
    await assertProductionMayRun(tx, route.workOrder.id);
  } catch (error) {
    if (input.trigger && input.trigger !== 'manual_start' && error instanceof ProductionControlError) return false;
    if (error instanceof ProductionControlError) {
      throw new ProcessRouteServiceError(error.message, error.status, error.code);
    }
    throw error;
  }
  ensureExecutableWeeklyOrder(route.workOrder);
  const timeReadiness = processRouteExecutionReadiness(route.steps);
  if (!timeReadiness.ready) {
    throw new ProcessRouteServiceError(
      `工序与工时尚未完整发布：${timeReadiness.missingStepNames.join('、')}`,
      409,
      'PROCESS_ROUTE_TIME_INCOMPLETE',
    );
  }
  const executableSteps = route.steps.filter(step => step.status !== 'skipped');
  const first = executableSteps[0];
  if (!first) {
    throw new ProcessRouteServiceError(
      '工艺路线没有可执行工序，请重新发布产品工序与工时',
      409,
      'PROCESS_ROUTE_EMPTY',
    );
  }
  const firstSequenceGroup = first.sequenceGroup;
  const firstSteps = executableSteps.filter(step => step.sequenceGroup === firstSequenceGroup);
  const initialInputQty = targetQuantity(route.workOrder);
  const stageGroup = normalizeProcessStageGroup(first.stageGroup) || 'frontend';
  const nextStage = processStageForGroup(stageGroup);
  const routeUpdate = await tx.workOrderProcessRoute.updateMany({
    where: { id: route.id, status: 'confirmed', startedAt: null },
    data: {
      status: 'in_progress',
      startedAt: input.now,
      version: { increment: 1 },
    },
  });
  if (routeUpdate.count !== 1) return false;
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: route.id, sequenceGroup: firstSequenceGroup, status: 'pending' },
    data: { status: 'current', startedAt: input.now, inputQty: initialInputQty, quantityVersion: { increment: 1 } },
  });
  await tx.workOrder.update({
    where: { id: input.workOrderId },
    data: {
      stage: nextStage,
      status: legacyStatusForStage(nextStage),
      startedAt: route.workOrder.startedAt || input.now,
      lastProgressAt: input.now,
      latestProgressRemark: `当前工序：${firstSteps.map(step => step.processName).join('、')}`,
    },
  });
  await tx.processRouteActivity.create({
    data: {
      routeId: route.id,
      stepId: first.id,
      action: 'start_process_route',
      content: `${input.trigger === 'drawing_issued'
        ? '确认图纸下发并'
        : input.trigger === 'automatic_plan_release' || input.trigger === 'automatic_plan_reconciliation'
          ? '计划自动启动并'
          : ''}开始 ${firstSteps.map(step => step.processName).join('、')}`,
      actorId: input.userId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.userId,
      action: 'start_process_route',
      targetType: 'work_order_process_route',
      targetId: route.id,
      detail: {
        workOrderId: input.workOrderId,
        processCode: first.processCode,
        trigger: input.trigger || 'manual_start',
        planActive: route.workOrder.planActive,
        weekStartDate: route.workOrder.weekStartDate?.toISOString() || null,
        drawingStatus: route.workOrder.drawingStatus,
        materialStatus: route.workOrder.materialStatus,
      },
    },
  });
  return true;
}

/** @deprecated Use the drawing-independent route starter. */
export async function startConfirmedProcessRouteAfterDrawing(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    userId: string;
    actor: string;
    now: Date;
  },
): Promise<boolean> {
  return startConfirmedProcessRoute(tx, { ...input, trigger: 'drawing_issued' });
}

export function parseProcessRouteAction(value: unknown): ProcessRouteCommand['action'] | null {
  return value === 'replace_steps' || value === 'apply_product_time' || value === 'confirm' || value === 'advance' ? value : null;
}

export function asProcessStepInput(value: unknown): ProcessStepInput[] {
  return Array.isArray(value) ? value as ProcessStepInput[] : [];
}

export async function loadProcessRoute(routeId: string) {
  return prisma.workOrderProcessRoute.findUnique({
    where: { id: routeId },
    include: processRouteInclude,
  });
}
