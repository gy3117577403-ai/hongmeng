import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyQualityClassification, buildQualityCorrectionPreview, loadQualityCorrectionState } from '@/lib/process-quality-correction-service';
import { planCompletionCoverage, processCompletionTargetQuantity, ProcessCompletionServiceError, reconcileQualityCorrection } from '@/lib/process-completion-service';
import { projectMaterialSequence } from '@/lib/process-material-sequence';

type Tx = Prisma.TransactionClient;
type State = Awaited<ReturnType<typeof loadQualityCorrectionState>>;
const serialize = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const hash = (v: unknown) => createHash('sha256').update(serialize(v)).digest('hex');
const json = (v: unknown) => JSON.parse(serialize(v));
const fail = (message: string, status = 409): never => { throw new ProcessCompletionServiceError(message, status, 'LINKED_QUALITY_CORRECTION_BLOCKED'); };

/** Preserve existing allocations; reserve ordinary consumers first. Only selected corrected
 * consumers may use later, same-work-date, action-only records, with explicit confirmation. */
function actionPlan(state: State, selected: Set<string>) {
  const rows = state.actionRows.map(r => ({ ...r, goodQty: selected.has(r.id) ? r.processedQty : r.goodQty,
    reportedGoodUnitQty: selected.has(r.id) ? r.reportedUnitQty : r.reportedGoodUnitQty }));
  const available = new Map(rows.map(r => [r.id, r.reportedGoodUnitQty]));
  const consumed = new Map<string, number>();
  for (const a of state.actionAllocations.filter(a => !a.voidedAt)) {
    available.set(a.sourceCompletionId, (available.get(a.sourceCompletionId) || 0) - a.quantity);
    consumed.set(a.consumerCompletionId, (consumed.get(a.consumerCompletionId) || 0) + a.quantity);
  }
  const additions: Array<{ stepId: string; sourceCompletionId: string; consumerCompletionId: string; quantity: number;
    sourceCompletedAt: string; consumerCompletedAt: string; laterAction: boolean }> = [];
  const blockers: string[] = [];
  if ([...available.values()].some(q => q < 0)) blockers.push('已有动作分配超过有效动作数量');
  for (const c of [...rows.filter(r => !selected.has(r.id)), ...rows.filter(r => selected.has(r.id))]) {
    let need = c.goodQty * c.unitsPerProduct - (consumed.get(c.id) || 0);
    if (need < 0) blockers.push('已有动作分配超过整套良品需求');
    for (let index = 0; index < rows.length && need > 0; index++) {
      const source = rows[index]; const later = index > rows.findIndex(r => r.id === c.id);
      if (later && !(selected.has(c.id) && source.processedQty === 0 && source.workDate.getTime() === c.workDate.getTime())) continue;
      const quantity = Math.min(need, Math.max(0, available.get(source.id) || 0));
      if (!quantity) continue;
      additions.push({ stepId: state.completion.stepId, sourceCompletionId: source.id, consumerCompletionId: c.id,
        quantity, sourceCompletedAt: source.completedAt.toISOString(), consumerCompletedAt: c.completedAt.toISOString(), laterAction: later });
      available.set(source.id, (available.get(source.id) || 0) - quantity); need -= quantity;
    }
    if (need > 0) blockers.push(`动作来源不足，报工 ${c.id} 尚缺 ${need} 个动作`);
  }
  return { additions, blockers };
}

async function loadPlan(tx: Tx, routeId: string, anchorId: string) {
  const anchor = await loadQualityCorrectionState(tx, routeId, anchorId);
  const records = await tx.processCompletion.findMany({ where: { routeId, voidedAt: null }, orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  const candidates = records.filter(r => r.defectQty > 0);
  if (!candidates.some(r => r.id === anchorId) || candidates.length > 20) fail('请选择有不良的原报工；关联更正一次最多 20 笔');
  const states: State[] = [];
  for (const r of candidates) states.push(r.id === anchorId ? anchor : await loadQualityCorrectionState(tx, routeId, r.id));
  const selected = new Set(candidates.map(r => r.id));
  const previews = states.map(s => buildQualityCorrectionPreview(s, true));
  const blockers = previews.flatMap(p => p.blockers.map(b => `${p.processName}：${b}`));
  const plans = [...new Map(states.map(s => [s.completion.stepId, s])).values()].map(s => actionPlan(s, selected));
  blockers.push(...plans.flatMap(p => p.blockers));
  const additions = plans.flatMap(p => p.additions);
  const withdrawals = await tx.processCompletionWithdrawalRequest.findMany({ where: { workOrderId: anchor.completion.workOrderId, status: 'PENDING' }, orderBy: { id: 'asc' } });
  if (withdrawals.some(r => additions.some(a => a.sourceCompletionId === r.completionId))) blockers.push('拟使用的动作来源存在待处理撤回申请');
  const branches = await tx.workOrder.findMany({ where: { parentWorkOrderId: anchor.completion.workOrderId }, orderBy: { id: 'asc' } });
  const cancelled = new Set(states.map(s => s.completion.branchWorkOrder?.id).filter(Boolean));
  if (branches.some(b => !b.deletedAt && !cancelled.has(b.id) && b.branchStatus !== 'CANCELLED')) blockers.push('存在本次更正之外的分支业务，需先核对');
  const obligations = await tx.processSupplementObligation.findMany({ where: { routeId }, orderBy: { id: 'asc' } });
  const steps = projectMaterialSequence(anchor.route.steps.map(s => ({ ...s })));
  const simulated = records.map(r => ({ ...r }));
  for (const c of simulated.filter(r => selected.has(r.id))) {
    const step = steps.find(s => s.id === c.stepId)!;
    step.processedQty -= c.coveredDefectQty; step.defectOutputQty -= c.coveredDefectQty;
    c.goodQty = c.processedQty; c.defectQty = 0; c.coveredQty = c.coveredGoodQty; c.coveredDefectQty = 0;
  }
  const normal = steps.filter(s => s.executionMode === 'NORMAL');
  const target = processCompletionTargetQuantity(anchor.completion.workOrder);
  let finishedDelta = 0;
  for (const step of normal) {
    for (const c of simulated.filter(r => r.stepId === step.id && r.coveredQty < r.processedQty)) {
      const p = planCompletionCoverage({ ...c, availableQty: Math.max(0, step.inputQty - step.processedQty) });
      c.coveredQty = p.coveredQty; c.coveredGoodQty = p.coveredGoodQty; c.coveredDefectQty = p.coveredDefectQty;
      step.processedQty += p.deltaQty; step.goodOutputQty += p.deltaGoodQty; step.defectOutputQty += p.deltaDefectQty;
      const group = normal.filter(s => s.sequenceGroup === step.sequenceGroup);
      const release = Math.min(target, ...group.map(s => s.goodOutputQty));
      const delta = Math.max(0, release - Math.min(...group.map(s => s.releasedGoodQty)));
      if (delta) {
        group.forEach(s => { s.releasedGoodQty = release; });
        const nextGroup = normal.find(s => s.sequenceGroup > step.sequenceGroup)?.sequenceGroup;
        if (nextGroup === undefined) finishedDelta += delta;
        else normal.filter(s => s.sequenceGroup === nextGroup).forEach(s => { s.inputQty += delta; });
      }
    }
  }
  const completedAfter = Number(anchor.completion.workOrder.completedQty || 0) + finishedDelta;
  const affectedSteps = steps.map(s => ({ id: s.id, name: s.processName, mode: s.executionMode,
    supplementReported: obligations.find(o => o.displayStepId === s.id)?.reportedQty || 0,
    beforeCovered: anchor.route.steps.find(x => x.id === s.id)!.processedQty, afterCovered: s.processedQty,
    afterGood: s.goodOutputQty, afterDefect: s.defectOutputQty, afterInput: s.inputQty,
    pending: simulated.filter(r => r.stepId === s.id).reduce((n, r) => n + r.processedQty - r.coveredQty, 0) }));
  const remaining = affectedSteps.filter(s => s.mode === 'NORMAL' && (s.pending > 0 || s.afterCovered < s.afterInput));
  const activeObligations = obligations.filter(o => o.status === 'ACTIVE').length;
  const closureReady = completedAfter === target && remaining.length === 0 && activeObligations === 0;
  const claims = anchor.labor.flatMap(p => p.claims.map(c => ({ id: c.id, poolId: p.id, employee: c.employee.name,
    workDate: c.workDate.toISOString().slice(0, 10), status: c.status, quantity: c.quantity,
    beforeMilliseconds: c.standardLaborMilliseconds.toString(), afterMilliseconds: c.standardLaborMilliseconds.toString() })));
  const preview = { routeId, anchorId, workOrderCode: anchor.completion.workOrder.businessCode || anchor.completion.workOrder.code,
    routeVersion: anchor.route.version, previewToken: hash({ states, records, withdrawals, branches, obligations }),
    corrections: previews, actionAllocations: additions, requiresLaterActionConfirmation: additions.some(a => a.laterAction),
    steps: affectedSteps, claims, laborBeforeHash: hash(anchor.labor), laborDifferenceMilliseconds: '0',
    closure: { target, beforeCompleted: Number(anchor.completion.workOrder.completedQty || 0), afterCompleted: completedAfter,
      expectedCompleted: closureReady, activeObligations, remainingSteps: remaining.map(s => s.name) },
    pendingWithdrawalCount: withdrawals.length,
    warnings: ['所有列出报工均须确认为真实劳动且仅质量分类误填，非重复报工。',
      ...(withdrawals.length ? ['现有撤回申请保留且不自动批准；已有真实报工仍参与数量核销。'] : []),
      ...(additions.some(a => a.laterAction) ? ['更正时使用同一工作日后录入的有效动作记录；保留原报工时间，不改工时。'] : [])],
    blockers: [...new Set(blockers)], canExecute: blockers.length === 0 };
  return { preview, states, records, anchor };
}

export type LinkedQualityCorrectionPreview = Awaited<ReturnType<typeof loadPlan>>['preview'];
export async function previewLinkedQualityCorrection(routeId: string, anchorId: string) {
  return prisma.$transaction(async tx => (await loadPlan(tx, routeId, anchorId)).preview,
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function correctLinkedQuality(input: { routeId: string; completionId: string; previewToken: unknown;
  idempotencyKey: unknown; reason: unknown; confirmActualWork: unknown; confirmLaterActions?: unknown; userId: string; actor: string }) {
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!/^[\w-]{8,100}$/.test(key) || reason.length < 4 || reason.length > 500 || input.confirmActualWork !== true
    || typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken)) fail('请先预览并确认所有列出记录均为真实劳动，填写 4–500 字原因', 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`linked-quality:${input.routeId}`}))`;
    const prior = await tx.operationLog.findFirst({ where: { action: 'correct_linked_quality', detail: { path: ['idempotencyKey'], equals: key } } });
    if (prior) {
      const d = prior.detail as Prisma.JsonObject;
      if (prior.targetId !== input.completionId || prior.userId !== input.userId || d.reason !== reason || d.previewToken !== input.previewToken) fail('请求标识已用于其他更正');
      return d.result;
    }
    const { preview, states, anchor } = await loadPlan(tx, input.routeId, input.completionId);
    if (preview.previewToken !== input.previewToken) fail('数量、工时或关联业务已变化，请重新预览');
    if (!preview.canExecute) fail(preview.blockers.join('；'));
    if (preview.requiresLaterActionConfirmation && input.confirmLaterActions !== true) fail('请确认使用预览中列出的同日后录入动作记录', 400);
    const now = new Date();
    for (const state of states) await applyQualityClassification(tx, state, { key: `${key}:${state.completion.id}`, reason, userId: input.userId, now });
    for (const a of preview.actionAllocations) await tx.processActionConsumption.upsert({
      where: { sourceCompletionId_consumerCompletionId: { sourceCompletionId: a.sourceCompletionId, consumerCompletionId: a.consumerCompletionId } },
      create: { stepId: a.stepId, sourceCompletionId: a.sourceCompletionId, consumerCompletionId: a.consumerCompletionId,
        quantity: a.quantity, idempotencyKey: `action-consume:${a.sourceCompletionId}:${a.consumerCompletionId}` },
      update: { quantity: { increment: a.quantity } },
    });
    const flow = await reconcileQualityCorrection(tx, { routeId: input.routeId, completionId: input.completionId,
      correctionKey: key, userId: input.userId, actor: input.actor, now });
    const after = await loadQualityCorrectionState(tx, input.routeId, input.completionId);
    if (hash(after.labor) !== hash(anchor.labor)) fail('工时逐笔校验失败，整次更正已回滚');
    if (Number(after.completion.workOrder.completedQty || 0) !== preview.closure.afterCompleted) fail('实际核销与预览不一致，整次更正已回滚');
    for (const s of preview.steps) {
      const actual = after.route.steps.find(r => r.id === s.id);
      if (!actual || actual.processedQty !== s.afterCovered || actual.goodOutputQty !== s.afterGood || actual.defectOutputQty !== s.afterDefect || actual.inputQty !== s.afterInput) fail('工序核销与预览不一致，整次更正已回滚');
    }
    if (preview.closure.expectedCompleted && after.completion.workOrder.status !== 'done') fail('仍存在结单阻断，整次更正已回滚');
    const result = { ...flow, workOrderId: anchor.completion.workOrderId, completedQty: after.completion.workOrder.completedQty,
      status: after.completion.workOrder.status, correctedCompletionIds: states.map(s => s.completion.id),
      cancelledBranchIds: states.flatMap(s => s.completion.branchWorkOrder ? [s.completion.branchWorkOrder.id] : []), laborDifferenceMilliseconds: '0' };
    const detail = json({ idempotencyKey: key, previewToken: input.previewToken, reason, before: preview,
      laborAfterHash: hash(after.labor), originalCompletionIds: states.map(s => s.completion.id), result });
    await tx.processRouteActivity.create({ data: { routeId: input.routeId, action: 'correct_linked_quality', actorId: input.userId,
      content: `关联更正 ${states.length} 笔误填不良；原工时逐笔不变；成品 ${result.completedQty}/${preview.closure.target}。原因：${reason}`, detail } });
    await tx.operationLog.create({ data: { userId: input.userId, action: 'correct_linked_quality', targetType: 'process_completion', targetId: input.completionId, detail } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}
