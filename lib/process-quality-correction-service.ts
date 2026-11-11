import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { materializeProcessActionConsumptions } from '@/lib/process-action-consumption';
import { ProcessCompletionServiceError, reconcileQualityCorrection } from '@/lib/process-completion-service';
import { isExecutableProductionWorkOrder } from '@/lib/work-orders';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(json(value))).digest('hex');
const fail = (message: string, code = 'QUALITY_CORRECTION_BLOCKED', status = 409): never => {
  throw new ProcessCompletionServiceError(message, status, code);
};

export async function loadQualityCorrectionState(tx: Tx, routeId: string, completionId: string) {
  const completion = await tx.processCompletion.findFirst({ where: { id: completionId, routeId }, include: {
    step: true, workOrder: true, qualityRecord: true,
    coverageAllocations: { where: { voidedAt: null }, orderBy: { id: 'asc' } },
    movements: { where: { voidedAt: null }, orderBy: { id: 'asc' } },
    withdrawalRequests: { where: { status: 'PENDING' } },
    branchWorkOrder: { include: {
      processRoute: { include: { steps: true } }, materialTask: true,
      _count: { select: { processCompletions: true, processLaborPools: true, reportingSubmissions: true,
        branchWorkOrders: true, quantityMovements: true, semiFinishedLots: true, dailyProcessTasks: true,
        dailyShipmentItems: true, qualityDataRecords: true, productionControlEvents: true, supplementObligations: true } },
    } },
  } });
  if (!completion) return fail('报工不存在', 'QUALITY_CORRECTION_NOT_FOUND', 404);
  const route = await tx.workOrderProcessRoute.findUniqueOrThrow({ where: { id: routeId }, include: {
    steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
  } });
  const labor = await tx.processLaborPool.findMany({ where: { workOrderId: completion.workOrderId }, orderBy: { id: 'asc' },
    include: { claims: { orderBy: { id: 'asc' }, include: { employee: { select: { name: true } } } } } });
  const pendingDefects = await tx.processCompletion.count({ where: { routeId, id: { not: completionId }, voidedAt: null,
    coverageStatus: { not: 'COVERED' }, defectQty: { gt: 0 } } });
  const actionRows = await tx.processCompletion.findMany({ where: { stepId: completion.stepId, voidedAt: null },
    orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, processedQty: true, goodQty: true, reportedUnitQty: true, reportedGoodUnitQty: true,
      reportedDefectUnitQty: true, unitsPerProduct: true, completedAt: true, createdAt: true, workDate: true, reportQuantityBasis: true } });
  const actionAllocations = await tx.processActionConsumption.findMany({ where: { stepId: completion.stepId }, orderBy: { id: 'asc' } });
  return { completion, route, labor, pendingDefects, actionRows, actionAllocations };
}

export function buildQualityCorrectionPreview(state: Awaited<ReturnType<typeof loadQualityCorrectionState>>, linked = false) {
  const { completion: c, route, labor, pendingDefects, actionRows, actionAllocations } = state;
  const blockers: string[] = [];
  const branch = c.branchWorkOrder;
  if (c.voidedAt || c.step.retiredAt || !['in_progress', 'completed'].includes(route.status)
    || c.workOrder.deletedAt || c.workOrder.stage === 'completed' || c.workOrder.status === 'done'
    || !isExecutableProductionWorkOrder(c.workOrder)) blockers.push('报工或路线当前不可更正');
  if (c.workOrder.branchType || c.workOrder.productionPausedAt) blockers.push('分支工单或暂停订单需单独处理');
  if (c.defectQty <= 0 || c.defectDisposition !== 'REWORK') blockers.push('此入口用于将误填不良全部更正为良品并作废误建返工单');
  if (c.reportQuantityBasis !== 'action' || c.timeBasis !== 'per_unit') blockers.push('该笔采用按良品或整批计工，不能使用保留动作工时的质量更正，请单独核对工时');
  if (c.supplementObligationId || c.reportingWipAllocationId || c.step.executionMode !== 'NORMAL') blockers.push('补充工序或半成品改排报工需单独处理');
  if (c.qualityRecord || c.qualityReport) blockers.push('该笔关联正式质检记录，需先核对质检结论');
  if (c.withdrawalRequests.length) blockers.push('该笔存在待处理撤回申请，请先处理申请');
  if (pendingDefects && !linked) blockers.push('后续待核销报工存在其他不良，需先核对其处置');
  if (route.steps.some(s => s.timeBasis === 'per_batch')) blockers.push('路线含整批工时分摊，需单独核对后再更正');
  if ((!branch && (!linked || c.coveredDefectQty > 0)) || (branch && (branch.branchType !== 'REWORK' || branch.branchStatus === 'CANCELLED' || branch.deletedAt))) blockers.push('未找到有效的关联返工单');
  if (branch && (Object.values(branch._count).some(n => n > 0) || branch.materialTask
    || branch.processRoute?.steps.some(s => s.processedQty || s.goodOutputQty || s.defectOutputQty || s.releasedGoodQty)
    || Number(branch.completedQty || 0) > 0)) blockers.push('返工单已经发生报工、工时、物料、计划或其他业务，不能作为误建空单作废');
  if (!linked && (c.coveredQty !== c.processedQty || c.coveredDefectQty !== c.defectQty || c.coveredGoodQty !== c.goodQty)) blockers.push('该笔尚未完整核销，需先核对数量台账');
  if (c.step.processedQty < c.coveredQty || c.step.goodOutputQty < c.coveredGoodQty || c.step.defectOutputQty < c.coveredDefectQty) blockers.push('工序累计数量与报工不一致');
  if (c.coverageAllocations.reduce((n, r) => n + r.quantity, 0) !== c.coveredQty
    || c.coverageAllocations.reduce((n, r) => n + r.goodQty, 0) !== c.coveredGoodQty
    || c.coverageAllocations.reduce((n, r) => n + r.defectQty, 0) !== c.coveredDefectQty) blockers.push('核销明细不完整，不能直接更正');
  const splits = c.movements.filter(m => m.type === 'REWORK_SPLIT');
  if (splits.reduce((n, m) => n + m.quantity, 0) !== (linked ? c.coveredDefectQty : c.defectQty) || splits.some(m => m.branchWorkOrderId !== branch?.id)) blockers.push('不良分流台账与返工单不一致');
  if (c.movements.some(m => !['REWORK_SPLIT', 'GOOD_TRANSFER', 'FINISHED_GOOD'].includes(m.type))) blockers.push('存在额外数量调整或返工回流，需单独核对');
  if (actionAllocations.some(a => a.voidedAt)) blockers.push('动作来源曾被撤销，需单独核对动作台账');
  let actions = 0;
  for (const row of actionRows) {
    if (row.reportQuantityBasis !== 'action') { blockers.push('该工序混用了动作与整套报工，需核对换算'); break; }
    actions += row.id === c.id ? row.reportedUnitQty : row.reportedGoodUnitQty;
    actions -= (row.id === c.id ? c.processedQty : row.goodQty) * row.unitsPerProduct;
    if (actions < 0 && !linked) { blockers.push('按原报工时点核算，可用动作不足以支持更正后的整套良品'); break; }
  }
  const ownPool = labor.find(p => p.completionId === c.id);
  if (ownPool && (ownPool.status === 'VOIDED' || ownPool.eligibleQty !== c.reportedUnitQty)) blockers.push('原报工工时池与动作数量不一致');
  const claims = (ownPool?.claims || []).filter(r => r.status === 'ACTIVE').map(r => ({
    id: r.id, employee: r.employee.name, workDate: r.workDate.toISOString().slice(0, 10), quantity: r.quantity,
    beforeMilliseconds: r.standardLaborMilliseconds.toString(), afterMilliseconds: r.standardLaborMilliseconds.toString(), differenceMilliseconds: '0',
  }));
  return {
    completionId: c.id, routeId: c.routeId, routeVersion: route.version, previewToken: hash(state),
    workOrderCode: c.workOrder.businessCode || c.workOrder.code, processName: c.step.processName,
    workDate: c.workDate.toISOString().slice(0, 10),
    before: { processedQty: c.processedQty, goodQty: c.goodQty, defectQty: c.defectQty, reportedUnitQty: c.reportedUnitQty,
      reportedGoodUnitQty: c.reportedGoodUnitQty, reportedDefectUnitQty: c.reportedDefectUnitQty },
    after: { processedQty: c.processedQty, goodQty: c.processedQty, defectQty: 0, reportedUnitQty: c.reportedUnitQty,
      reportedGoodUnitQty: c.reportedUnitQty, reportedDefectUnitQty: 0 },
    branch: branch ? { id: branch.id, code: branch.businessCode || branch.code, status: branch.branchStatus, proposedStatus: 'CANCELLED', dependencies: branch._count } : null,
    labor: { policy: '保留原动作报工工时，不新增、不冲销、不重新分配', claims, poolId: ownPool?.id || null,
      totalMilliseconds: ownPool?.totalStandardLaborMilliseconds.toString() || '0', differenceMilliseconds: '0' },
    blockers: [...new Set(blockers)], canExecute: blockers.length === 0,
    warnings: ['须先确认这是真实劳动且仅质量分类误填；重复报工不适用本操作。',
      '按现有有效记录重新核销后续工序，不保证整单立即完结；缺失数量和待撤回记录仍需核对。'],
  };
}

export type QualityCorrectionPreview = ReturnType<typeof buildQualityCorrectionPreview>;
export async function previewQualityCorrection(routeId: string, completionId: string) {
  // Repeatable-read gives a consistent, strictly read-only preview. No activity or business row is written.
  return prisma.$transaction(async tx => buildQualityCorrectionPreview(await loadQualityCorrectionState(tx, routeId, completionId)),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}

export async function correctQualityQuantity(input: {
  routeId: string; completionId: string; previewToken: unknown; idempotencyKey: unknown; reason: unknown;
  confirmActualWork: unknown; userId: string; actor: string;
}) {
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!/^[\w-]{8,100}$/.test(key) || reason.length < 4 || reason.length > 500 || input.confirmActualWork !== true
    || typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken)) {
    return fail('请先预览、确认真实劳动并填写 4–500 字更正原因', 'QUALITY_CORRECTION_INPUT', 400);
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quality-correction:${key}`}))`;
    const prior = await tx.operationLog.findFirst({ where: { action: 'correct_quality_quantity', detail: { path: ['idempotencyKey'], equals: key } } });
    if (prior) {
      const detail = prior.detail as Prisma.JsonObject;
      if (prior.targetId !== input.completionId || detail.reason !== reason || detail.previewToken !== input.previewToken || prior.userId !== input.userId) return fail('请求标识已用于其他更正', 'QUALITY_CORRECTION_KEY_CONFLICT');
      return detail.result;
    }
    const state = await loadQualityCorrectionState(tx, input.routeId, input.completionId);
    const preview = buildQualityCorrectionPreview(state);
    if (preview.previewToken !== input.previewToken) return fail('数量、返工或工时已变化，请重新预览', 'QUALITY_CORRECTION_STALE');
    if (!preview.canExecute) return fail(preview.blockers.join('；'));
    const c = state.completion;
    const branch = c.branchWorkOrder!;
    const now = new Date();
    const laborBefore = hash(state.labor);
    await applyQualityClassification(tx, state, { key, reason, userId: input.userId, now });
    await materializeProcessActionConsumptions(tx, c.stepId, true);
    const flow = await reconcileQualityCorrection(tx, { routeId: c.routeId, completionId: c.id, correctionKey: key,
      userId: input.userId, actor: input.actor, now });
    const afterState = await loadQualityCorrectionState(tx, c.routeId, c.id);
    if (hash(afterState.labor) !== laborBefore) return fail('工时逐笔校验失败，已取消本次更正', 'QUALITY_CORRECTION_LABOR_CHANGED');
    const result = { ...flow, completionId: c.id, cancelledBranchId: branch.id, laborDifferenceMilliseconds: '0' };
    const detail = json({ idempotencyKey: key, reason, previewToken: input.previewToken, before: preview.before, after: preview.after,
      branch: preview.branch, labor: preview.labor, laborBeforeHash: laborBefore, laborAfterHash: hash(afterState.labor),
      beforeActionAllocations: state.actionAllocations, afterActionAllocations: afterState.actionAllocations, result });
    await tx.processRouteActivity.create({ data: { routeId: c.routeId, stepId: c.stepId, action: 'correct_quality_quantity',
      actorId: input.userId, content: `${c.step.processName}误填不良 ${c.defectQty} 更正为良品；关联返工单作废；原动作工时不变。原因：${reason}`, detail } });
    await tx.operationLog.create({ data: { userId: input.userId, action: 'correct_quality_quantity', targetType: 'process_completion', targetId: c.id, detail } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

/** Shared quantity-only mutation. Caller must validate the complete plan and protect labor. */
export async function applyQualityClassification(tx: Tx, state: Awaited<ReturnType<typeof loadQualityCorrectionState>>,
  input: { key: string; reason: string; userId: string; now: Date }) {
  const c = state.completion;
  const branch = c.branchWorkOrder;
  const { key, reason, now } = input;
    if (branch) await tx.workOrder.update({ where: { id: branch.id }, data: { branchStatus: 'CANCELLED', status: 'cancelled', planActive: false,
      executionVersion: { increment: 1 }, latestProgressRemark: `误建返工单作废：${reason}` } });
    if (branch?.processRoute) {
      await tx.workOrderProcessRoute.update({ where: { id: branch.processRoute.id }, data: { status: 'cancelled', version: { increment: 1 } } });
      await tx.processRouteActivity.create({ data: { routeId: branch.processRoute.id, action: 'cancel_mistaken_rework',
        actorId: input.userId, content: `质量数量更正，误建返工单作废：${reason}`, detail: { completionId: c.id, correctionKey: key } } });
    }
    for (const movement of c.movements.filter(m => m.type === 'REWORK_SPLIT')) {
      await tx.processQuantityMovement.update({ where: { id: movement.id }, data: { voidedAt: now } });
      await tx.processQuantityMovement.create({ data: { completionId: c.id, workOrderId: c.workOrderId, sourceStepId: c.stepId,
        targetStepId: movement.targetStepId, branchWorkOrderId: branch!.id, type: 'REVERSAL', quantity: movement.quantity,
        sourceSequenceGroup: movement.sourceSequenceGroup, targetSequenceGroup: movement.targetSequenceGroup,
        reversalOfId: movement.id, idempotencyKey: `quality:${key}:${movement.id}` } });
    }
    await tx.processCompletionCoverage.updateMany({ where: { reportCompletionId: c.id, voidedAt: null }, data: { voidedAt: now } });
    for (const allocation of c.coverageAllocations.filter(a => a.goodQty > 0)) {
      await tx.processCompletionCoverage.create({ data: { reportCompletionId: c.id, triggerCompletionId: allocation.triggerCompletionId,
        quantity: allocation.goodQty, goodQty: allocation.goodQty, defectQty: 0,
        idempotencyKey: `quality-keep:${key}:${allocation.id}` } });
    }
    await tx.workOrderProcessStep.update({ where: { id: c.stepId }, data: {
      processedQty: { decrement: c.coveredDefectQty },
      defectOutputQty: { decrement: c.coveredDefectQty }, quantityVersion: { increment: 1 },
    } });
    await tx.processCompletion.update({ where: { id: c.id }, data: {
      goodQty: c.processedQty, defectQty: 0, reportedGoodUnitQty: c.reportedUnitQty, reportedDefectUnitQty: 0,
      defectDisposition: null, coveredQty: c.coveredGoodQty, coveredDefectQty: 0,
      coverageStatus: c.coveredGoodQty > 0 ? 'PARTIAL' : 'PENDING', coverageUpdatedAt: now,
    } });
}
