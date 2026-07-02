import type { WorkOrder } from '@prisma/client';

export const WORK_ORDER_STAGES = ['not_issued', 'frontend', 'backend', 'completed'] as const;
export const PRIORITIES = ['urgent', 'high', 'normal'] as const;
export const STATUSES = ['pending', 'processing', 'done'] as const;

export type WorkOrderStage = (typeof WORK_ORDER_STAGES)[number];

export const stageText: Record<WorkOrderStage, string> = {
  not_issued: '未发图',
  frontend: '在前端',
  backend: '在后端',
  completed: '已完成',
};

const stageAliases: Record<string, WorkOrderStage> = {
  not_issued: 'not_issued',
  pending: 'not_issued',
  未发图: 'not_issued',
  待处理: 'not_issued',
  frontend: 'frontend',
  processing: 'frontend',
  前端: 'frontend',
  在前端: 'frontend',
  进行中: 'frontend',
  backend: 'backend',
  后端: 'backend',
  在后端: 'backend',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  已完成: 'completed',
};

export function normalizeWorkOrderStage(value: unknown): WorkOrderStage | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return stageAliases[text] || null;
}

export function workOrderStageText(value: unknown) {
  const stage = normalizeWorkOrderStage(value) || 'not_issued';
  return stageText[stage];
}

export function legacyStatusForStage(stage: WorkOrderStage) {
  if (stage === 'completed') return 'done';
  if (stage === 'not_issued') return 'pending';
  return 'processing';
}

export function normalizePriority(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '紧急') return 'urgent';
  if (text === '高') return 'high';
  if (text === '一般') return 'normal';
  return PRIORITIES.includes(text as (typeof PRIORITIES)[number]) ? text : null;
}

export function parsePlannedAt(value: unknown): { value?: Date | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  const raw = String(value).trim();
  if (!raw) return { value: null };
  const normalized = raw.replace(/\//g, '-').replace(' ', 'T');
  const local = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  const date = local
    ? new Date(Date.UTC(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4] || 0) - 8,
      Number(local[5] || 0),
      Number(local[6] || 0),
    ))
    : new Date(normalized);
  if (Number.isNaN(date.getTime())) return { error: '计划时间格式不合法' };
  return { value: date };
}

type WorkOrderBody = {
  code?: unknown;
  productName?: unknown;
  stage?: unknown;
  status?: unknown;
  priority?: unknown;
  progress?: unknown;
  plannedAt?: unknown;
  remark?: unknown;
};

function str(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

export function parseWorkOrderBody(body: WorkOrderBody, options: { partial?: boolean } = {}) {
  const data: Record<string, string | number | Date | null> = {};
  const errors: string[] = [];
  const partial = !!options.partial;

  if (!partial || body.code !== undefined) {
    const code = str(body.code);
    if (!code) errors.push('工单号不能为空');
    else data.code = code.slice(0, 80);
  }

  if (!partial || body.productName !== undefined) {
    const productName = str(body.productName);
    if (!productName) errors.push('产品名称不能为空');
    else data.productName = productName.slice(0, 120);
  }

  const stageInput = body.stage !== undefined ? body.stage : body.status;
  if (!partial || stageInput !== undefined) {
    const stage = normalizeWorkOrderStage(stageInput) || (partial ? null : 'not_issued');
    if (!stage) errors.push('状态不合法');
    else {
      data.stage = stage;
      data.status = legacyStatusForStage(stage);
    }
  }

  if (!partial || body.priority !== undefined) {
    const priority = normalizePriority(body.priority) || (partial ? null : 'normal');
    if (!priority) errors.push('优先级不正确');
    else data.priority = priority;
  }

  if (!partial || body.progress !== undefined) {
    const progress = Number(body.progress ?? 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.push('进度必须在 0-100 之间');
    else data.progress = Math.round(progress);
  }

  if (body.plannedAt !== undefined) {
    const planned = parsePlannedAt(body.plannedAt);
    if (planned.error) errors.push(planned.error);
    else data.plannedAt = planned.value ?? null;
  }

  if (body.remark !== undefined) {
    const remark = str(body.remark);
    data.remark = remark ? remark.slice(0, 500) : null;
  } else if (!partial) {
    data.remark = null;
  }

  return { data, errors };
}

export function serializeWorkOrder(order: WorkOrder & { resourceFiles?: { categoryId: string }[] }) {
  const categoryFileCounts: Record<string, number> = {};
  for (const file of order.resourceFiles || []) {
    categoryFileCounts[file.categoryId] = (categoryFileCounts[file.categoryId] || 0) + 1;
  }
  const stage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';

  return {
    id: order.id,
    code: order.code,
    productName: order.productName,
    stage,
    stageText: stageText[stage],
    progress: order.progress,
    priority: order.priority,
    status: order.status,
    remark: order.remark,
    plannedAt: order.plannedAt?.toISOString() || null,
    deletedAt: order.deletedAt?.toISOString() || null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    categoryFileCounts,
    totalFileCount: Object.values(categoryFileCounts).reduce((sum, count) => sum + count, 0),
  };
}
