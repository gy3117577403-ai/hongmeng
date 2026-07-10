import type { Prisma, WorkOrder } from '@prisma/client';
import { legacyStatusForStage, normalizePriority, normalizeWorkOrderStage } from '@/lib/work-orders';
import { safeCompletedQuantity } from '@/lib/production-execution';

export type ExecutionUpdateInput = {
  stage?: unknown;
  productionOwner?: unknown;
  workstation?: unknown;
  completedQty?: unknown;
  remark?: unknown;
  priority?: unknown;
};

export type PreparedExecutionUpdate = {
  data: Prisma.WorkOrderUpdateInput;
  changedFields: string[];
  stage: string;
  previousStage: string;
  completedQty: string | null;
  productionOwner: string | null;
  workstation: string | null;
  remark: string | null;
};

function optionalText(value: unknown, max: number) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function prepareExecutionUpdate(order: WorkOrder, input: ExecutionUpdateInput, now = new Date()): { update?: PreparedExecutionUpdate; error?: string } {
  const currentStage = normalizeWorkOrderStage(order.stage || order.status) || 'not_issued';
  let nextStage = currentStage;
  const data: Prisma.WorkOrderUpdateInput = {};
  const changedFields: string[] = [];

  if (input.stage !== undefined) {
    const normalized = normalizeWorkOrderStage(input.stage);
    if (!normalized) return { error: '生产状态不正确' };
    nextStage = normalized;
    if (nextStage !== currentStage) {
      data.stage = nextStage;
      data.status = legacyStatusForStage(nextStage);
      changedFields.push('stage');
    }
  }

  let productionOwner = order.productionOwner;
  if (input.productionOwner !== undefined) {
    productionOwner = optionalText(input.productionOwner, 120);
    if (productionOwner !== order.productionOwner) {
      data.productionOwner = productionOwner;
      changedFields.push('productionOwner');
    }
  }

  let workstation = order.workstation;
  if (input.workstation !== undefined) {
    workstation = optionalText(input.workstation, 120);
    if (workstation !== order.workstation) {
      data.workstation = workstation;
      changedFields.push('workstation');
    }
  }

  let completedQty = order.completedQty;
  const quantity = safeCompletedQuantity(input.completedQty);
  if (quantity.error) return { error: quantity.error };
  if (quantity.provided) {
    completedQty = quantity.value ?? null;
    if (completedQty !== order.completedQty) {
      data.completedQty = completedQty;
      changedFields.push('completedQty');
    }
  }

  if (input.priority !== undefined) {
    const priority = normalizePriority(input.priority);
    if (!priority) return { error: '优先级不正确' };
    if (priority !== order.priority) {
      data.priority = priority;
      changedFields.push('priority');
    }
  }

  let remark: string | null = null;
  if (input.remark !== undefined) {
    remark = optionalText(input.remark, 500);
    if (remark) {
      data.latestProgressRemark = remark;
      changedFields.push('remark');
    }
  }

  if (!changedFields.length) return { error: '至少需要修改一个执行字段或填写进度备注' };

  if (!order.startedAt && (nextStage === 'frontend' || nextStage === 'backend')) data.startedAt = now;
  if (nextStage === 'completed' && currentStage !== 'completed') data.completedAt = now;
  if (currentStage === 'completed' && nextStage !== 'completed') data.completedAt = null;
  data.lastProgressAt = now;

  return {
    update: {
      data,
      changedFields: [...new Set(changedFields)],
      stage: nextStage,
      previousStage: currentStage,
      completedQty: completedQty ?? null,
      productionOwner: productionOwner ?? null,
      workstation: workstation ?? null,
      remark,
    },
  };
}
