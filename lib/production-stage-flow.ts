import { normalizeWorkOrderStage, type WorkOrderStage } from '@/lib/work-orders';

export type ProductionStageSegment = {
  stage: WorkOrderStage;
  quantity: number;
};

export type ProductionStageFlowInput = {
  uncompletedQty?: unknown;
  completedQty?: unknown;
  frontendTransferredQty?: number | null;
  executionVersion?: number | null;
  stage?: unknown;
  status?: unknown;
};

export type ProductionStageFlowState = {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  frontendRemainingQty: number;
  backendRemainingQty: number;
  executionVersion: number;
  overallStage: WorkOrderStage;
  legacy: boolean;
  materialized: boolean;
  segments: ProductionStageSegment[];
};

export type ProductionStageFlowError = {
  code:
    | 'INVALID_TARGET_QUANTITY'
    | 'INVALID_COMPLETED_QUANTITY'
    | 'INVALID_FRONTEND_TRANSFERRED_QUANTITY'
    | 'INVALID_EXECUTION_VERSION'
    | 'UNKNOWN_STAGE'
    | 'COMPLETED_EXCEEDS_TARGET'
    | 'COMPLETED_EXCEEDS_TRANSFERRED'
    | 'TRANSFERRED_EXCEEDS_TARGET'
    | 'LEGACY_STAGE_QUANTITY_CONFLICT'
    | 'STAGE_QUANTITY_CONFLICT';
  field: 'uncompletedQty' | 'completedQty' | 'frontendTransferredQty' | 'executionVersion' | 'stage';
  message: string;
};

export type ProductionStageFlowResolution =
  | { ok: true; state: ProductionStageFlowState }
  | { ok: false; error: ProductionStageFlowError };

type IntegerParseResult = { ok: true; value: number } | { ok: false };

const quantityPattern = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\s*(?:套|件|个|pcs))?$/i;

export function parseProductionInteger(value: unknown, emptyAsZero = false): IntegerParseResult {
  if (value === null || value === undefined || String(value).trim() === '') {
    return emptyAsZero ? { ok: true, value: 0 } : { ok: false };
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? { ok: true, value } : { ok: false };
  }
  const normalized = String(value).trim().replace(/，/g, ',');
  if (!quantityPattern.test(normalized)) return { ok: false };
  const digits = normalized.replace(/\s*(?:套|件|个|pcs)$/i, '').replace(/,/g, '');
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false };
}

export function parsePositiveProductionQuantity(value: unknown): IntegerParseResult {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? { ok: true, value } : { ok: false };
  }
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return { ok: false };
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false };
}

export function parseExecutionVersion(value: unknown): IntegerParseResult {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? { ok: true, value } : { ok: false };
  }
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return { ok: false };
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false };
}

export function compatibleStageForQuantities(input: {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  drawingPending?: boolean;
}): WorkOrderStage {
  if (input.drawingPending && input.frontendTransferredQty === 0 && input.completedQty === 0) return 'not_issued';
  if (input.completedQty === input.targetQty) return 'completed';
  if (input.targetQty - input.frontendTransferredQty > 0) return 'frontend';
  return 'backend';
}

export function productionStageSegments(input: {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  overallStage: WorkOrderStage;
}): ProductionStageSegment[] {
  if (input.overallStage === 'not_issued') {
    return input.targetQty > 0 ? [{ stage: 'not_issued', quantity: input.targetQty }] : [];
  }
  const segments: ProductionStageSegment[] = [];
  const frontend = input.targetQty - input.frontendTransferredQty;
  const backend = input.frontendTransferredQty - input.completedQty;
  if (frontend > 0) segments.push({ stage: 'frontend', quantity: frontend });
  if (backend > 0) segments.push({ stage: 'backend', quantity: backend });
  if (input.completedQty > 0) segments.push({ stage: 'completed', quantity: input.completedQty });
  return segments;
}

function failure(error: ProductionStageFlowError): ProductionStageFlowResolution {
  return { ok: false, error };
}

export function resolveEffectiveFrontendTransferredQty(input: ProductionStageFlowInput): ProductionStageFlowResolution {
  const target = parseProductionInteger(input.uncompletedQty);
  if (!target.ok) {
    return failure({ code: 'INVALID_TARGET_QUANTITY', field: 'uncompletedQty', message: '目标数量必须是合法的非负整数' });
  }
  const completed = parseProductionInteger(input.completedQty, true);
  if (!completed.ok) {
    return failure({ code: 'INVALID_COMPLETED_QUANTITY', field: 'completedQty', message: '累计完成数量必须是合法的非负整数' });
  }
  if (completed.value > target.value) {
    return failure({ code: 'COMPLETED_EXCEEDS_TARGET', field: 'completedQty', message: '累计完成数量不能超过目标数量' });
  }
  const stage = normalizeWorkOrderStage(input.stage ?? input.status);
  if (!stage) return failure({ code: 'UNKNOWN_STAGE', field: 'stage', message: '工单生产阶段无法识别' });

  const version = input.executionVersion ?? 0;
  if (!Number.isSafeInteger(version) || version < 0) {
    return failure({ code: 'INVALID_EXECUTION_VERSION', field: 'executionVersion', message: '生产进度版本不正确' });
  }

  const materialized = input.frontendTransferredQty !== null && input.frontendTransferredQty !== undefined;
  let transferred: number;
  if (materialized) {
    transferred = input.frontendTransferredQty as number;
    if (!Number.isSafeInteger(transferred) || transferred < 0) {
      return failure({ code: 'INVALID_FRONTEND_TRANSFERRED_QUANTITY', field: 'frontendTransferredQty', message: '累计进入后端数量必须是合法的非负整数' });
    }
    if (transferred > target.value) {
      return failure({ code: 'TRANSFERRED_EXCEEDS_TARGET', field: 'frontendTransferredQty', message: '累计进入后端数量不能超过目标数量' });
    }
    if (completed.value > transferred) {
      return failure({ code: 'COMPLETED_EXCEEDS_TRANSFERRED', field: 'completedQty', message: '累计完成数量不能超过累计进入后端数量' });
    }
    const expectedStage = compatibleStageForQuantities({
      targetQty: target.value,
      frontendTransferredQty: transferred,
      completedQty: completed.value,
      drawingPending: stage === 'not_issued',
    });
    if (stage !== expectedStage) {
      return failure({ code: 'STAGE_QUANTITY_CONFLICT', field: 'stage', message: '工单阶段与数量流转状态不一致' });
    }
  } else {
    transferred = stage === 'backend' || stage === 'completed' ? target.value : 0;
    if ((stage === 'not_issued' || stage === 'frontend') && completed.value > 0) {
      return failure({ code: 'LEGACY_STAGE_QUANTITY_CONFLICT', field: 'completedQty', message: '历史前端工单存在无法解释的完成数量' });
    }
    if (stage === 'backend' && completed.value === target.value && target.value > 0) {
      return failure({ code: 'LEGACY_STAGE_QUANTITY_CONFLICT', field: 'stage', message: '历史后端工单数量已完成但阶段尚未完成' });
    }
    if (stage === 'completed' && completed.value !== target.value) {
      return failure({ code: 'LEGACY_STAGE_QUANTITY_CONFLICT', field: 'completedQty', message: '历史已完成工单的完成数量与目标数量不一致' });
    }
  }

  const state: ProductionStageFlowState = {
    targetQty: target.value,
    frontendTransferredQty: transferred,
    completedQty: completed.value,
    frontendRemainingQty: target.value - transferred,
    backendRemainingQty: transferred - completed.value,
    executionVersion: version,
    overallStage: stage,
    legacy: !materialized,
    materialized,
    segments: [],
  };
  state.segments = productionStageSegments(state);
  return { ok: true, state };
}
