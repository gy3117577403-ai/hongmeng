import type { WorkOrder } from '@prisma/client';

export const STAGES = ['前端', '后端', '未发图'] as const;
export const PRIORITIES = ['urgent', 'high', 'normal'] as const;
export const STATUSES = ['pending', 'processing', 'done'] as const;

type WorkOrderBody = {
  code?: unknown;
  productName?: unknown;
  stage?: unknown;
  priority?: unknown;
  status?: unknown;
  progress?: unknown;
  remark?: unknown;
};

function str(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

export function parseWorkOrderBody(body: WorkOrderBody, options: { partial?: boolean } = {}) {
  const data: Record<string, string | number | null> = {};
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

  if (!partial || body.stage !== undefined) {
    const stage = str(body.stage) || '未发图';
    if (!STAGES.includes(stage as (typeof STAGES)[number])) errors.push('阶段不正确');
    else data.stage = stage;
  }

  if (!partial || body.priority !== undefined) {
    const priority = str(body.priority) || 'normal';
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) errors.push('优先级不正确');
    else data.priority = priority;
  }

  if (!partial || body.status !== undefined) {
    const status = str(body.status) || 'pending';
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) errors.push('状态不正确');
    else data.status = status;
  }

  if (!partial || body.progress !== undefined) {
    const progress = Number(body.progress ?? 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) errors.push('进度必须在 0-100 之间');
    else data.progress = Math.round(progress);
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

  return {
    id: order.id,
    code: order.code,
    productName: order.productName,
    stage: order.stage,
    progress: order.progress,
    priority: order.priority,
    status: order.status,
    remark: order.remark,
    deletedAt: order.deletedAt?.toISOString() || null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    categoryFileCounts,
    totalFileCount: Object.values(categoryFileCounts).reduce((sum, count) => sum + count, 0),
  };
}
