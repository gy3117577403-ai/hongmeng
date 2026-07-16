import { Prisma } from '@prisma/client';
import type {
  WarehouseExceptionType,
  WarehouseMaterialStatus,
  WarehouseMaterialTaskDTO,
} from '@/types';

export const WAREHOUSE_MATERIAL_STATUSES: WarehouseMaterialStatus[] = ['pending', 'completed', 'exception'];
export const WAREHOUSE_EXCEPTION_TYPES: WarehouseExceptionType[] = [
  'shortage',
  'wrong_material',
  'insufficient_quantity',
  'quality_issue',
  'other',
];

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
  if ((exceptionType === 'shortage' || exceptionType === 'insufficient_quantity') && !expectedAt) {
    return { ok: false, statusCode: 400, error: '缺料或数量不足必须填写预计到料时间' };
  }
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
  return {
    id: task.id,
    workOrderId: task.workOrderId,
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
    isExpectedOverdue: isExpectedOverdue(status, task.expectedAt, now),
    workOrder: {
      ...task.workOrder,
      plannedAt: task.workOrder.plannedAt?.toISOString() || null,
      weekStartDate: task.workOrder.weekStartDate?.toISOString() || null,
      weekEndDate: task.workOrder.weekEndDate?.toISOString() || null,
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
