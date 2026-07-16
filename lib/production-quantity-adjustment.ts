import {
  compatibleStageForQuantities,
  parsePositiveProductionQuantity,
  parseProductionInteger,
} from '@/lib/production-stage-flow';
import { normalizeWorkOrderStage, type WorkOrderStage } from '@/lib/work-orders';

export type ProductionQuantityAdjustmentInput = {
  targetQty: unknown;
  frontendTransferredQty: unknown;
  completedQty: unknown;
  currentStage: unknown;
};

export type ProductionQuantityAdjustmentValue = {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  frontendRemainingQty: number;
  backendRemainingQty: number;
  nextStage: WorkOrderStage;
  stageQuantity: number;
  percentage: number;
  reopensCompletedOrder: boolean;
};

export type ProductionQuantityAdjustmentResult =
  | { ok: true; value: ProductionQuantityAdjustmentValue }
  | { ok: false; code: string; field: 'targetQty' | 'frontendTransferredQty' | 'completedQty' | 'currentStage'; message: string };

export function prepareProductionQuantityAdjustment(input: ProductionQuantityAdjustmentInput): ProductionQuantityAdjustmentResult {
  const target = parsePositiveProductionQuantity(input.targetQty);
  if (!target.ok) {
    return { ok: false, code: 'INVALID_TARGET_QUANTITY', field: 'targetQty', message: '总目标必须是大于 0 的整数' };
  }
  const transferred = parseProductionInteger(input.frontendTransferredQty);
  if (!transferred.ok) {
    return { ok: false, code: 'INVALID_TRANSFERRED_QUANTITY', field: 'frontendTransferredQty', message: '累计进入后端数量必须是非负整数' };
  }
  const completed = parseProductionInteger(input.completedQty);
  if (!completed.ok) {
    return { ok: false, code: 'INVALID_COMPLETED_QUANTITY', field: 'completedQty', message: '累计完成数量必须是非负整数' };
  }
  if (completed.value > transferred.value) {
    return { ok: false, code: 'COMPLETED_EXCEEDS_TRANSFERRED', field: 'completedQty', message: '累计完成数量不能超过累计进入后端数量' };
  }
  if (transferred.value > target.value) {
    return { ok: false, code: 'TRANSFERRED_EXCEEDS_TARGET', field: 'frontendTransferredQty', message: '累计进入后端数量不能超过总目标' };
  }
  const currentStage = normalizeWorkOrderStage(input.currentStage);
  if (!currentStage) {
    return { ok: false, code: 'UNKNOWN_STAGE', field: 'currentStage', message: '当前生产阶段无法识别' };
  }

  const nextStage = compatibleStageForQuantities({
    targetQty: target.value,
    frontendTransferredQty: transferred.value,
    completedQty: completed.value,
    drawingPending: currentStage === 'not_issued' && transferred.value === 0 && completed.value === 0,
  });
  const stageQuantity = nextStage === 'not_issued'
    ? target.value
    : nextStage === 'frontend'
      ? target.value - transferred.value
      : nextStage === 'backend'
        ? transferred.value - completed.value
        : completed.value;

  return {
    ok: true,
    value: {
      targetQty: target.value,
      frontendTransferredQty: transferred.value,
      completedQty: completed.value,
      frontendRemainingQty: target.value - transferred.value,
      backendRemainingQty: transferred.value - completed.value,
      nextStage,
      stageQuantity,
      percentage: Math.round((completed.value / target.value) * 1000) / 10,
      reopensCompletedOrder: currentStage === 'completed' && nextStage !== 'completed',
    },
  };
}
