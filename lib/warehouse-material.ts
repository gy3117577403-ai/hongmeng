import { Prisma } from '@prisma/client';
import { sampleMaterialSource, sampleMaterialSourceSelect } from '@/lib/sample-material-source';
import type {
  MaterialFollowUpStatusDTO,
  WarehouseExceptionType,
  WarehouseMaterialExceptionCaseDTO,
  WarehouseMaterialStatus,
  WarehouseMaterialTaskDTO,
} from '@/types';
import { materialSource, materialExceptionLabel } from '@/lib/material-source';
import { activeProductionCarryoverWorkOrderWhere } from '@/lib/production-carryovers';

export const WAREHOUSE_MATERIAL_STATUSES: WarehouseMaterialStatus[] = ['pending', 'completed', 'exception'];
export const WAREHOUSE_EXCEPTION_TYPES: WarehouseExceptionType[] = [
  'shortage',
  'wrong_material',
  'insufficient_quantity',
  'quality_issue',
  'other',
];

export type WarehouseMaterialScope = 'current' | 'open' | 'preparation' | 'history';

function addWarehouseDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sameWarehouseDay(value: Date): { gte: Date; lt: Date } {
  return { gte: value, lt: addWarehouseDays(value, 1) };
}

export function warehouseMaterialScopeWeekStart(
  scope: WarehouseMaterialScope,
  currentWeekStart: Date,
  requestedWeekStart: Date | null = null,
): Date | null {
  if (scope === 'current' || scope === 'open') return currentWeekStart;
  if (scope === 'preparation') return requestedWeekStart || addWarehouseDays(currentWeekStart, 7);
  return requestedWeekStart;
}

export function procurementOwnedExpectedArrival(input: {
  currentExpectedAt: Date | null;
  eventExpectedArrivalAt?: Date | null;
  followUpExpectedAt?: Date | null;
}): Date | null {
  return input.followUpExpectedAt
    ?? input.eventExpectedArrivalAt
    ?? input.currentExpectedAt
    ?? null;
}

export function warehouseMaterialWorkOrderWhere(input: {
  scope: WarehouseMaterialScope;
  currentWeekStart: Date;
  requestedWeekStart?: Date | null;
}): Prisma.WorkOrderWhereInput {
  const managedPlanEvidence: Prisma.WorkOrderWhereInput = {
    OR: [
      { planType: { in: ['weekly_plan', 'managed_plan'] } },
      {
        productionPlanBatch: {
          is: {
            deletedAt: null,
            releaseState: { in: ['preparation', 'active', 'archived'] },
            planOrder: { deletedAt: null },
          },
        },
      },
    ],
  };
  const selectedWeekStart = warehouseMaterialScopeWeekStart(
    input.scope,
    input.currentWeekStart,
    input.requestedWeekStart || null,
  );

  if (input.scope === 'current' || input.scope === 'open') {
    return {
      AND: [
        { deletedAt: null },
        managedPlanEvidence,
        {
          OR: [
            {
              planActive: true,
              weekStartDate: sameWarehouseDay(input.currentWeekStart),
            },
            activeProductionCarryoverWorkOrderWhere(input.currentWeekStart),
            ...(input.scope === 'open' ? [{
              weekStartDate: { lt: input.currentWeekStart },
              materialTask: { is: { status: { in: ['pending', 'exception'] } } },
            }] : []),
          ],
        },
      ],
    };
  }
  if (input.scope === 'preparation') {
    return {
      AND: [
        { deletedAt: null },
        managedPlanEvidence,
        {
          planActive: false,
          productionPlanBatch: { is: { releaseState: 'preparation', deletedAt: null } },
          weekStartDate: sameWarehouseDay(selectedWeekStart!),
        },
      ],
    };
  }
  return {
    AND: [
      { deletedAt: null },
      managedPlanEvidence,
      {
        weekStartDate: selectedWeekStart
          ? sameWarehouseDay(selectedWeekStart)
          : { lt: input.currentWeekStart },
      },
    ],
  };
}

export const warehouseStatusText: Record<WarehouseMaterialStatus, string> = {
  pending: '待配料',
  completed: '已配料',
  exception: '仓库异常',
};

export const warehouseExceptionText: Record<WarehouseExceptionType, string> = {
  shortage: '缺料',
  wrong_material: '料错',
  insufficient_quantity: '数量不足',
  quality_issue: '来料质量异常',
  other: '其他异常',
};

export const warehouseMaterialTaskListInclude = Prisma.validator<Prisma.WarehouseMaterialTaskInclude>()({
  sampleTask: { select: sampleMaterialSourceSelect },
  workOrder: {
    select: {
      id: true,
      code: true,
      customerName: true,
      specification: true,
      productName: true,
      processName: true,
      uncompletedQty: true,
      productionTargetQty: true,
      plannedAt: true,
      deliveryDay: true,
      weekStartDate: true,
      weekEndDate: true,
      planActive: true,
      stage: true,
    },
  },
  completedBy: { select: { id: true, username: true, displayName: true } },
  updatedBy: { select: { id: true, username: true, displayName: true } },
  followUpTasks: {
    where: { warehouseException: { status: 'OPEN' } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      owner: { select: { id: true, username: true, displayName: true } },
      expectedAt: true,
      latestProgress: true,
      updatedAt: true,
    },
  },
  exceptionCases: {
    where: { status: { in: ['OPEN', 'RESOLVED'] } },
    orderBy: { sequence: 'desc' },
    include: {
      followUpTask: { select: {
        id: true, status: true, latestProgress: true, lastFollowedAt: true,
        assignedAt: true, acceptedAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
        activities: { take: 1, orderBy: { createdAt: 'desc' }, select: {
          createdAt: true, content: true, actor: { select: { id: true, username: true, displayName: true } },
        } },
      } },
      reportedBy: { select: { id: true, username: true, displayName: true } },
      expectedArrivalBy: { select: { id: true, username: true, displayName: true } },
      actualArrivalBy: { select: { id: true, username: true, displayName: true } },
      resolvedBy: { select: { id: true, username: true, displayName: true } },
    },
  },
});

export const warehouseMaterialTaskDetailInclude = Prisma.validator<Prisma.WarehouseMaterialTaskInclude>()({
  ...warehouseMaterialTaskListInclude,
  activities: {
    orderBy: { createdAt: 'desc' },
    take: 40,
    include: { actor: { select: { id: true, username: true, displayName: true } } },
  },
});

export type WarehouseMaterialTaskRecord = Prisma.WarehouseMaterialTaskGetPayload<{
  include: typeof warehouseMaterialTaskListInclude;
}>;

export type WarehouseMaterialTaskDetailRecord = Prisma.WarehouseMaterialTaskGetPayload<{
  include: typeof warehouseMaterialTaskDetailInclude;
}>;

export type WarehouseTaskAction = 'complete' | 'report_exception' | 'update_exception' | 'resolve' | 'reopen';

export type WarehouseTaskTransitionInput = {
  action?: unknown;
  exceptionType?: unknown;
  exceptionNote?: unknown;
  expectedAt?: unknown;
  resolution?: unknown;
  note?: unknown;
};

export type WarehouseTaskTransitionState = {
  status: WarehouseMaterialStatus;
  exceptionType: WarehouseExceptionType | null;
  exceptionNote: string | null;
  expectedAt: Date | null;
  completedAt: Date | null;
};

export type WarehouseTaskTransitionResult =
  | { ok: false; statusCode: number; error: string }
  | {
      ok: true;
      action: WarehouseTaskAction;
      next: WarehouseTaskTransitionState;
      content: string;
    };

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function parseExpectedAt(value: unknown): Date | null {
  const text = cleanText(value, 40);
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00+08:00`)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function chinaDayStart(value = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string): number => Number(parts.find(item => item.type === type)?.value || 0);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), -8));
}

function exceptionInput(input: WarehouseTaskTransitionInput, now: Date): WarehouseTaskTransitionResult {
  const exceptionType = cleanText(input.exceptionType, 40) as WarehouseExceptionType;
  if (!WAREHOUSE_EXCEPTION_TYPES.includes(exceptionType)) {
    return { ok: false, statusCode: 400, error: '请选择有效的仓库异常类型' };
  }
  const exceptionNote = cleanText(input.exceptionNote, 400);
  if (!exceptionNote) return { ok: false, statusCode: 400, error: '请填写异常说明' };
  const expectedAt = parseExpectedAt(input.expectedAt);
  if (input.expectedAt && !expectedAt) return { ok: false, statusCode: 400, error: '预计解决时间格式不正确' };
  if (expectedAt && expectedAt < chinaDayStart(now)) {
    return { ok: false, statusCode: 400, error: '预计解决时间不能早于今天' };
  }
  return {
    ok: true,
    action: input.action === 'update_exception' ? 'update_exception' : 'report_exception',
    next: { status: 'exception', exceptionType, exceptionNote, expectedAt, completedAt: null },
    content: `${warehouseExceptionText[exceptionType]}：${exceptionNote}`,
  };
}

export function prepareWarehouseTaskTransition(
  current: WarehouseTaskTransitionState,
  input: WarehouseTaskTransitionInput,
  now = new Date(),
): WarehouseTaskTransitionResult {
  const action = cleanText(input.action, 40) as WarehouseTaskAction;
  if (action === 'complete') {
    if (current.status === 'completed') return { ok: false, statusCode: 409, error: '该工单已经完成配料' };
    if (current.status === 'exception') return { ok: false, statusCode: 409, error: '请先确认仓库异常处理结果' };
    return {
      ok: true,
      action,
      next: { status: 'completed', exceptionType: null, exceptionNote: null, expectedAt: null, completedAt: now },
      content: '完成配料',
    };
  }
  if (action === 'report_exception' || action === 'update_exception') {
    if (action === 'update_exception' && current.status !== 'exception') {
      return { ok: false, statusCode: 409, error: '当前任务不是异常状态，无法更新异常' };
    }
    return exceptionInput(input, now);
  }
  if (action === 'resolve') {
    if (current.status !== 'exception') return { ok: false, statusCode: 409, error: '当前任务没有待解决的仓库异常' };
    const resolution = cleanText(input.resolution, 20);
    if (resolution !== 'pending' && resolution !== 'completed') {
      return { ok: false, statusCode: 400, error: '请选择异常解决后的配料状态' };
    }
    const note = cleanText(input.note, 300);
    if (!note) return { ok: false, statusCode: 400, error: '请填写异常解决说明' };
    return {
      ok: true,
      action,
      next: {
        status: resolution,
        exceptionType: null,
        exceptionNote: null,
        expectedAt: null,
        completedAt: resolution === 'completed' ? now : null,
      },
      content: note,
    };
  }
  if (action === 'reopen') {
    if (current.status !== 'completed') return { ok: false, statusCode: 409, error: '只有已配料任务可以取消完成' };
    const note = cleanText(input.note, 300);
    if (!note) return { ok: false, statusCode: 400, error: '请填写取消已配料的原因' };
    return {
      ok: true,
      action,
      next: { status: 'pending', exceptionType: null, exceptionNote: null, expectedAt: null, completedAt: null },
      content: note,
    };
  }
  return { ok: false, statusCode: 400, error: '不支持的仓库任务操作' };
}

export function warehouseLegacyMaterialStatus(state: WarehouseTaskTransitionState): string {
  if (state.status === 'completed') return '已配料';
  if (state.status === 'pending') return '未配料';
  const type = state.exceptionType ? warehouseExceptionText[state.exceptionType] : '仓库异常';
  return `${type}${state.exceptionNote ? `：${state.exceptionNote}` : ''}`.slice(0, 200);
}

function isExpectedOverdue(status: string, expectedAt: Date | null, now: Date): boolean {
  return status === 'exception' && !!expectedAt && expectedAt < chinaDayStart(now);
}

type WarehouseExceptionCaseRecord = Prisma.WarehouseMaterialExceptionCaseGetPayload<{
  include: {
    reportedBy: { select: { id: true; username: true; displayName: true } };
    expectedArrivalBy: { select: { id: true; username: true; displayName: true } };
    actualArrivalBy: { select: { id: true; username: true; displayName: true } };
    resolvedBy: { select: { id: true; username: true; displayName: true } };
  };
}>;

export function serializeWarehouseExceptionCase(
  exceptionCase: WarehouseExceptionCaseRecord,
): WarehouseMaterialExceptionCaseDTO {
  const exceptionType = WAREHOUSE_EXCEPTION_TYPES.includes(exceptionCase.exceptionType as WarehouseExceptionType)
    ? exceptionCase.exceptionType as WarehouseExceptionType
    : 'other';
  return {
    id: exceptionCase.id,
    sequence: exceptionCase.sequence,
    status: exceptionCase.status,
    exceptionType,
    exceptionTypeText: materialExceptionLabel(exceptionType, exceptionCase.supplySource),
    supplySource: materialSource(exceptionCase.supplySource),
    materialModel: exceptionCase.materialModel,
    shortageQuantity: exceptionCase.shortageQuantity,
    receivedQuantity: exceptionCase.receivedQuantity,
    unit: exceptionCase.unit,
    exceptionNote: exceptionCase.exceptionNote,
    weekStartDate: exceptionCase.weekStartDate?.toISOString() || null,
    weekEndDate: exceptionCase.weekEndDate?.toISOString() || null,
    reportedAt: exceptionCase.reportedAt.toISOString(),
    reportedBy: exceptionCase.reportedBy,
    expectedArrivalAt: exceptionCase.expectedArrivalAt?.toISOString() || null,
    expectedArrivalBy: exceptionCase.expectedArrivalBy,
    expectedArrivalUpdatedAt: exceptionCase.expectedArrivalUpdatedAt?.toISOString() || null,
    actualArrivalAt: exceptionCase.actualArrivalAt?.toISOString() || null,
    actualArrivalBy: exceptionCase.actualArrivalBy,
    resolvedAt: exceptionCase.resolvedAt?.toISOString() || null,
    resolvedBy: exceptionCase.resolvedBy,
    resolutionNote: exceptionCase.resolutionNote,
  };
}

export function serializeWarehouseMaterialTask(
  task: WarehouseMaterialTaskRecord | WarehouseMaterialTaskDetailRecord,
  now = new Date(),
): WarehouseMaterialTaskDTO {
  const status = WAREHOUSE_MATERIAL_STATUSES.includes(task.status as WarehouseMaterialStatus)
    ? task.status as WarehouseMaterialStatus
    : 'pending';
  const exceptionType = WAREHOUSE_EXCEPTION_TYPES.includes(task.exceptionType as WarehouseExceptionType)
    ? task.exceptionType as WarehouseExceptionType
    : null;
  const detailTask = task as WarehouseMaterialTaskDetailRecord;
  const activeFollowUp = task.followUpTasks[0] || null;
  const lastResolvedException = task.exceptionCases.find(e => e.status === 'RESOLVED') || null;
  const synchronizedExpectedAt = task.expectedAt || activeFollowUp?.expectedAt;
  const openExceptions = task.exceptionCases.filter(e => e.status === 'OPEN');
  const hasOverdueArrival = openExceptions.length
    ? openExceptions.some(e => e.followUpTask?.status !== 'WAITING_WAREHOUSE' && isExpectedOverdue(status, e.expectedArrivalAt, now))
    : isExpectedOverdue(status, synchronizedExpectedAt, now);
  const source = task.workOrder || sampleMaterialSource(task.sampleTask);
  return {
    id: task.id,
    workOrderId: task.workOrderId || '',
    sampleTaskId: task.sampleTaskId,
    sampleTaskType: task.sampleTask?.taskType,
    requirements: task.requirements as unknown as import('@/lib/sample-plan-domain').SampleMaterialLine[],
    requirementsConfirmed: task.requirementsConfirmed,
    status,
    statusText: warehouseStatusText[status],
    exceptionType,
    exceptionTypeText: exceptionType ? warehouseExceptionText[exceptionType] : null,
    exceptionNote: task.exceptionNote,
    expectedAt: task.expectedAt?.toISOString() || null,
    completedAt: task.completedAt?.toISOString() || null,
    completedBy: task.completedBy,
    updatedBy: task.updatedBy,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    isExpectedOverdue: hasOverdueArrival,
    followUpTask: activeFollowUp ? {
      id: activeFollowUp.id,
      status: activeFollowUp.status as MaterialFollowUpStatusDTO,
      statusText: ({
        PENDING: '待接收',
        IN_PROGRESS: '跟进中',
        WAITING_ARRIVAL: '等待物料',
        WAITING_WAREHOUSE: '待仓库确认',
        RESOLVED: '已解决',
        CANCELLED: '已取消',
      } as Record<MaterialFollowUpStatusDTO, string>)[activeFollowUp.status as MaterialFollowUpStatusDTO],
      owner: activeFollowUp.owner,
      expectedAt: activeFollowUp.expectedAt?.toISOString() || null,
      latestProgress: activeFollowUp.latestProgress,
      updatedAt: activeFollowUp.updatedAt.toISOString(),
    } : null,
    activeExceptions: task.exceptionCases.filter(e => e.status === 'OPEN').map(e => ({
      ...serializeWarehouseExceptionCase(e), followUpId: e.followUpTask?.id || null,
      followUpStatus: e.followUpTask?.status || null, owner: e.followUpTask?.owner || null,
      assignedAt: e.followUpTask?.assignedAt?.toISOString() || null,
      acceptedAt: e.followUpTask?.acceptedAt?.toISOString() || null,
      latestProgress: e.followUpTask?.activities?.[0]?.content || e.followUpTask?.latestProgress || null,
      lastFollowedAt: e.followUpTask?.activities?.[0]?.createdAt.toISOString() || e.followUpTask?.lastFollowedAt?.toISOString() || null,
      latestActor: e.followUpTask?.activities?.[0]?.actor || null,
    })),
    lastResolvedException: lastResolvedException ? serializeWarehouseExceptionCase(lastResolvedException) : null,
    workOrder: {
      ...source,
      plannedAt: source.plannedAt?.toISOString() || null,
      weekStartDate: source.weekStartDate?.toISOString() || null,
      weekEndDate: source.weekEndDate?.toISOString() || null,
    },
    activities: Array.isArray(detailTask.activities)
      ? detailTask.activities.map(activity => ({
          id: activity.id,
          action: activity.action,
          fromStatus: activity.fromStatus as WarehouseMaterialStatus | null,
          toStatus: activity.toStatus as WarehouseMaterialStatus | null,
          content: activity.content,
          actor: activity.actor,
          createdAt: activity.createdAt.toISOString(),
        }))
      : undefined,
  };
}
