import { MaterialFollowUpStatus, Prisma } from '@prisma/client';
import type {
  MaterialFollowUpRiskDTO,
  MaterialFollowUpStatusDTO,
  MaterialFollowUpTaskDTO,
  WarehouseExceptionType,
} from '@/types';

export const MATERIAL_FOLLOW_UP_ACTIVE_STATUSES: MaterialFollowUpStatus[] = [
  MaterialFollowUpStatus.PENDING,
  MaterialFollowUpStatus.IN_PROGRESS,
  MaterialFollowUpStatus.WAITING_ARRIVAL,
  MaterialFollowUpStatus.WAITING_WAREHOUSE,
];

export const materialFollowUpStatusText: Record<MaterialFollowUpStatusDTO, string> = {
  PENDING: '待接收',
  IN_PROGRESS: '跟进中',
  WAITING_ARRIVAL: '等待物料',
  WAITING_WAREHOUSE: '待仓库确认',
  RESOLVED: '已解决',
  CANCELLED: '已取消',
};

export const materialFollowUpListInclude = Prisma.validator<Prisma.MaterialFollowUpTaskInclude>()({
  owner: { select: { id: true, username: true, displayName: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  warehouseTask: {
    select: {
      status: true,
      exceptionType: true,
      exceptionNote: true,
      expectedAt: true,
      workOrder: {
        select: {
          id: true,
          code: true,
          customerName: true,
          specification: true,
          productName: true,
          productionTargetQty: true,
          uncompletedQty: true,
          plannedAt: true,
          deliveryDay: true,
          priority: true,
        },
      },
    },
  },
});

export const materialFollowUpDetailInclude = Prisma.validator<Prisma.MaterialFollowUpTaskInclude>()({
  ...materialFollowUpListInclude,
  activities: {
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: { actor: { select: { id: true, username: true, displayName: true } } },
  },
});

export type MaterialFollowUpListRecord = Prisma.MaterialFollowUpTaskGetPayload<{
  include: typeof materialFollowUpListInclude;
}>;

export type MaterialFollowUpDetailRecord = Prisma.MaterialFollowUpTaskGetPayload<{
  include: typeof materialFollowUpDetailInclude;
}>;

export type MaterialFollowUpTransitionState = {
  status: MaterialFollowUpStatusDTO;
  ownerId: string | null;
  expectedAt: Date | null;
};

export type MaterialFollowUpTransitionInput = {
  action?: unknown;
  status?: unknown;
  ownerId?: unknown;
  expectedAt?: unknown;
  note?: unknown;
};

export type MaterialFollowUpTransitionResult =
  | { ok: false; statusCode: number; error: string }
  | {
      ok: true;
      action: 'claim' | 'update';
      next: {
        status: MaterialFollowUpStatus;
        ownerId: string;
        expectedAt: Date | null;
        latestProgress: string;
        lastFollowedAt: Date;
      };
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

export function chinaDayStart(value = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string): number => Number(parts.find(item => item.type === type)?.value || 0);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), -8));
}

export function isTrackedWarehouseException(type: WarehouseExceptionType | null | undefined): boolean {
  return type === 'shortage' || type === 'insufficient_quantity';
}

export function prepareMaterialFollowUpTransition(
  current: MaterialFollowUpTransitionState,
  input: MaterialFollowUpTransitionInput,
  actorId: string,
  now = new Date(),
): MaterialFollowUpTransitionResult {
  if (current.status === 'RESOLVED' || current.status === 'CANCELLED') {
    return { ok: false, statusCode: 409, error: '该缺料反馈已经结束，请从仓库重新登记异常' };
  }
  const action = cleanText(input.action, 20);
  if (action === 'claim') {
    return {
      ok: true,
      action: 'claim',
      next: {
        status: MaterialFollowUpStatus.IN_PROGRESS,
        ownerId: actorId,
        expectedAt: current.expectedAt,
        latestProgress: '已接收缺料反馈，开始跟进',
        lastFollowedAt: now,
      },
      content: '接收缺料反馈并开始跟进',
    };
  }
  if (action !== 'update') {
    return { ok: false, statusCode: 400, error: '不支持的缺料跟进操作' };
  }

  const status = cleanText(input.status, 40) as MaterialFollowUpStatus;
  const updateStatuses = new Set<MaterialFollowUpStatus>([
    MaterialFollowUpStatus.IN_PROGRESS,
    MaterialFollowUpStatus.WAITING_ARRIVAL,
    MaterialFollowUpStatus.WAITING_WAREHOUSE,
  ]);
  if (!updateStatuses.has(status)) {
    return { ok: false, statusCode: 400, error: '请选择有效的跟进状态' };
  }
  const ownerId = cleanText(input.ownerId, 80);
  if (!ownerId) return { ok: false, statusCode: 400, error: '请选择跟进负责人' };
  const latestProgress = cleanText(input.note, 600);
  if (!latestProgress) return { ok: false, statusCode: 400, error: '请填写本次跟进进展' };
  const expectedAt = parseExpectedAt(input.expectedAt);
  if (input.expectedAt && !expectedAt) {
    return { ok: false, statusCode: 400, error: '预计解决时间格式不正确' };
  }
  if (status === MaterialFollowUpStatus.WAITING_ARRIVAL && !expectedAt) {
    return { ok: false, statusCode: 400, error: '等待物料时必须填写预计解决时间' };
  }
  if (expectedAt && expectedAt < chinaDayStart(now)) {
    return { ok: false, statusCode: 400, error: '预计解决时间不能早于今天' };
  }
  return {
    ok: true,
    action: 'update',
    next: {
      status,
      ownerId,
      expectedAt,
      latestProgress,
      lastFollowedAt: now,
    },
    content: latestProgress,
  };
}

export function materialFollowUpRisk(
  status: MaterialFollowUpStatusDTO,
  ownerId: string | null,
  expectedAt: Date | null,
  now = new Date(),
): { risk: MaterialFollowUpRiskDTO; riskText: string } {
  if (status === 'RESOLVED' || status === 'CANCELLED') return { risk: 'closed', riskText: '已结束' };
  const start = chinaDayStart(now);
  if (expectedAt && expectedAt < start) return { risk: 'overdue', riskText: '已逾期' };
  if (!ownerId) return { risk: 'unassigned', riskText: '待认领' };
  if (expectedAt && expectedAt.getTime() - start.getTime() <= 24 * 60 * 60 * 1000) {
    return { risk: 'due_soon', riskText: '即将到期' };
  }
  return { risk: 'normal', riskText: '正常跟进' };
}

export function serializeMaterialFollowUpTask(
  task: MaterialFollowUpListRecord | MaterialFollowUpDetailRecord,
  now = new Date(),
): MaterialFollowUpTaskDTO {
  const status = task.status as MaterialFollowUpStatusDTO;
  const risk = materialFollowUpRisk(status, task.ownerId, task.expectedAt, now);
  const detail = task as MaterialFollowUpDetailRecord;
  return {
    id: task.id,
    warehouseTaskId: task.warehouseTaskId,
    status,
    statusText: materialFollowUpStatusText[status],
    ...risk,
    owner: task.owner,
    createdBy: task.createdBy,
    resolvedBy: task.resolvedBy,
    latestProgress: task.latestProgress,
    expectedAt: task.expectedAt?.toISOString() || null,
    lastFollowedAt: task.lastFollowedAt?.toISOString() || null,
    resolvedAt: task.resolvedAt?.toISOString() || null,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    warehouseTask: {
      status: task.warehouseTask.status as MaterialFollowUpTaskDTO['warehouseTask']['status'],
      exceptionType: task.warehouseTask.exceptionType as WarehouseExceptionType | null,
      exceptionNote: task.warehouseTask.exceptionNote,
      expectedAt: task.warehouseTask.expectedAt?.toISOString() || null,
    },
    workOrder: {
      ...task.warehouseTask.workOrder,
      plannedAt: task.warehouseTask.workOrder.plannedAt?.toISOString() || null,
    },
    activities: Array.isArray(detail.activities)
      ? detail.activities.map(activity => ({
          id: activity.id,
          action: activity.action,
          fromStatus: activity.fromStatus as MaterialFollowUpStatusDTO | null,
          toStatus: activity.toStatus as MaterialFollowUpStatusDTO | null,
          content: activity.content,
          actor: activity.actor,
          createdAt: activity.createdAt.toISOString(),
        }))
      : undefined,
  };
}
