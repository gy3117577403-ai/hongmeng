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
  drawingStatus?: unknown;
};

export type PreparedExecutionUpdate = {
  data: Prisma.WorkOrderUpdateInput;
  changedFields: string[];
  stage: string;
  previousStage: string;
  completedQty: string | null;
  productionOwner: string | null;
  workstation: string | null;
  drawingStatus: string | null;
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

  let drawingStatus = order.drawingStatus;
  let drawingStatusChanged = false;
  if (input.drawingStatus !== undefined) {
    const nextDrawingStatus = optionalText(input.drawingStatus, 80);
    const allowed = new Set(['未发', '已发', '待样品确认', '待客户确认', '图纸需变更', '已确认']);
    if (!nextDrawingStatus || !allowed.has(nextDrawingStatus)) return { error: '图纸状态不正确' };
    drawingStatus = nextDrawingStatus;
    if (drawingStatus !== order.drawingStatus) {
      data.drawingStatus = drawingStatus;
      if (!order.drawingIssuedAt && (drawingStatus === '已发' || drawingStatus === '已确认')) data.drawingIssuedAt = now;
      changedFields.push('drawingStatus');
      drawingStatusChanged = true;
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
  if (!remark && drawingStatusChanged) remark = `图纸状态更新：${drawingStatus}`;

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
      drawingStatus: drawingStatus ?? null,
      remark,
    },
  };
}
