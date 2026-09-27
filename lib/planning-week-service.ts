import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaDate, chinaWeekRange, editableProductionPlanningWeek } from '@/lib/production-planning';
import { resolvePlanMilliseconds } from '@/lib/planning-time';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { lockProductionWorkOrder } from '@/lib/production-work-order-lock';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { subtractWorkload, weekRemainder } from '@/lib/planning-week-domain';

export class PlanningWeekError extends Error { constructor(message: string, public status = 400) { super(message); } }
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x));
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(json(v))).digest('hex');
const include = Prisma.validator<Prisma.ProductionPlanBatchInclude>()({
  weekSlots: { orderBy: { weekStartDate: 'asc' } }, planOrder: true,
  semiFinishedLots: { where: { scheduleStatus: { not: 'CANCELLED' } }, select: { id: true } },
  workOrder: { include: { materialTask: true, processRoute: { include: { steps: { where: { retiredAt: null }, orderBy: { position: 'asc' }, include: { supplementObligation: true } } } } } },
});
type Batch = Prisma.ProductionPlanBatchGetPayload<{ include: typeof include }>;
type Command = { action: 'defer' | 'join' | 'move'; batchIds: string[]; targetWeek?: string; completionDate?: string; reason?: string; requestKey?: string; fingerprint?: string };
export type WeekCommandInput = Command;

function remaining(b: Batch) {
  const summary = getProductionQuantitySummary(b.workOrder!);
  const result = weekRemainder(b.quantity, resolvePlanMilliseconds(b.unitMillisecondsSnapshot, b.planOrder.planningUnitMilliseconds), summary.completedQty || 0, b.workOrder?.processRoute?.steps || []);
  // Route standards may change after earlier weeks were recorded. Never move
  // more imported plan time than is still allocated to the current week.
  if (b.weekSlots.length && result.planned !== null && result.remainingPlanned !== null) {
    const source = b.weekSlots.find(s => chinaDate(s.weekStartDate) === chinaDate(b.weekStartDate));
    const available = b.scheduleState === 'DEFERRED'
      ? subtractWorkload(result.planned, b.weekSlots.reduce((n, s) => n + (s.plannedMilliseconds || 0n), 0n))
      : source?.plannedMilliseconds;
    if (available != null && result.remainingPlanned > available) result.remainingPlanned = available;
  }
  return result;
}
function inspect(b: Batch, input: Command) {
  if (b.deletedAt || b.planOrder.deletedAt || b.planOrder.status === 'cancelled' || b.workOrder?.deletedAt) throw new PlanningWeekError('所选订单已取消或删除，请刷新', 409);
  if (!b.workOrder || !['active', 'preparation'].includes(b.releaseState)) throw new PlanningWeekError(`${b.planOrder.specification}：仅下达后的未完成订单可暂退或转周；草稿请使用调配周次`, 409);
  if (b.workOrder.completedAt || b.workOrder.stage === 'completed') throw new PlanningWeekError(`${b.planOrder.specification} 已完成，历史工时不能退出`, 409);
  if (b.semiFinishedLots.length) throw new PlanningWeekError(`${b.planOrder.specification} 已有半成品分支，请在半成品续作中转周，避免重复分配同一工作量`, 409);
  if (input.action === 'defer' && b.scheduleState === 'DEFERRED' || input.action === 'join' && b.scheduleState !== 'DEFERRED') throw new PlanningWeekError('暂退状态已变化，请刷新', 409);
  const r = remaining(b);
  if (!r.remainingQuantity && (!r.remainingStandard || r.remainingStandard === 0n)) throw new PlanningWeekError(`${b.planOrder.specification} 没有剩余工作量`, 409);
  if (r.started && r.basis === 'quantity' && b.workOrder.processRoute?.steps.length) throw new PlanningWeekError(`${b.planOrder.specification} 已部分开工但工序标准不全，请先补齐工时后转周，避免错误扣减`, 409);
  return r;
}
async function load(tx: Prisma.TransactionClient, input: Command, lock: boolean) {
  if (!['defer', 'join', 'move'].includes(input.action) || !Array.isArray(input.batchIds) || !input.batchIds.length || input.batchIds.length > 100 || input.batchIds.some(id => typeof id !== 'string')) throw new PlanningWeekError('请选择 1–100 个订单');
  const ids = [...new Set(input.batchIds)].sort();
  if (lock) {
    const roots = await tx.productionPlanBatch.findMany({ where: { id: { in: ids } }, select: { workOrderId: true } });
    for (const id of roots.flatMap(b => b.workOrderId ? [b.workOrderId] : []).sort()) await lockProductionWorkOrder(tx, id);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM production_plan_batches WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  }
  const batches = await tx.productionPlanBatch.findMany({ where: { id: { in: ids } }, include, orderBy: { id: 'asc' } });
  if (batches.length !== ids.length) throw new PlanningWeekError('订单不存在，请刷新', 404);
  return batches;
}
function makePreview(batches: Batch[], input: Command) {
  const target = input.action === 'defer' ? null : editableProductionPlanningWeek(input.targetWeek);
  if (input.action !== 'defer' && !target) throw new PlanningWeekError('请选择本周或未来 11 周');
  const completion = input.completionDate || (target ? chinaDate(target.end) : null);
  if (target && (!completion || completion < chinaDate(target.start) || completion > chinaDate(target.end) || !/^\d{4}-\d{2}-\d{2}$/.test(completion))) throw new PlanningWeekError('内部完成日期必须在目标周内');
  const rows = batches.map(b => {
    const r = inspect(b, input);
    if (input.action === 'move' && b.scheduleState !== 'DEFERRED' && chinaDate(b.weekStartDate) === chinaDate(target!.start)) throw new PlanningWeekError('目标周与当前周相同');
    return { id: b.id, specification: b.planOrder.specification, customer: b.planOrder.customerName,
      sourceWeek: chinaDate(b.weekStartDate), targetWeek: target ? chinaDate(target.start) : null,
      state: b.scheduleState, remainingQuantity: r.remainingQuantity,
      remainingPlanned: r.remainingPlanned?.toString() ?? null, remainingStandard: r.remainingStandard?.toString() ?? null,
      basis: r.basis, started: r.started, materialReady: b.workOrder?.materialTask?.status === 'completed',
      independentPause: !!b.workOrder?.productionPausedAt && (b.workOrder.productionPause as Prisma.JsonObject)?.source !== 'WEEK_SCHEDULE',
    };
  });
  return { action: input.action, targetWeek: target ? chinaDate(target.start) : null, completionDate: completion, rows,
    fingerprint: digest({ batches: batches.map(b => ({ id: b.id, v: b.scheduleVersion, updated: b.updatedAt, work: b.workOrder, slots: b.weekSlots })), action: input.action, target: target && chinaDate(target.start), completion }) };
}
export type PlanningWeekPreview = ReturnType<typeof makePreview>;
export async function previewPlanningWeek(input: Command) {
  return prisma.$transaction(async tx => makePreview(await load(tx, input, false), input));
}
export async function commitPlanningWeek(input: Command, actor: { id: string; displayName?: string | null; username: string }) {
  const key = String(input.requestKey || '').trim();
  const reason = String(input.reason || '').trim().slice(0, 400);
  if (!key || key.length > 120 || !reason || !input.fingerprint) throw new PlanningWeekError('请预览影响范围并填写原因');
  const hash = digest({ input, actor: actor.id });
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`planning-week:${key}`}))`;
    const replay = await tx.productionPlanWeekCommand.findUnique({ where: { key } });
    if (replay) { if (replay.hash !== hash) throw new PlanningWeekError('操作编号冲突', 409); return replay.result; }
    const batches = await load(tx, input, true), preview = makePreview(batches, input);
    if (input.fingerprint !== preview.fingerprint) throw new PlanningWeekError('订单进度或计划已变化，请重新预览后提交', 409);
    const now = new Date(), currentWeek = chinaDate(chinaWeekRange(now).start);
    for (const b of batches) {
      const r = remaining(b), sourceWeek = chinaWeekRange(b.weekStartDate);
      const existing = b.weekSlots.find(s => chinaDate(s.weekStartDate) === chinaDate(sourceWeek.start));
      const source = existing || await tx.productionPlanWeekSlot.create({ data: { batchId: b.id,
        weekStartDate: sourceWeek.start, weekEndDate: sourceWeek.end, completionDate: b.plannedCompletionDate,
        quantity: b.quantity, plannedMilliseconds: r.planned, standardMilliseconds: r.standard, stepMilliseconds: Object.fromEntries(Object.entries(r.stepWork).map(([id, v]) => [id, v.full])) } });
      if (b.scheduleState !== 'DEFERRED') {
        await tx.productionPlanWeekSlot.update({ where: { id: source.id }, data: {
          quantity: Math.max(0, source.quantity - r.remainingQuantity),
          plannedMilliseconds: subtractWorkload(source.plannedMilliseconds, r.remainingPlanned),
          standardMilliseconds: subtractWorkload(source.standardMilliseconds, r.remainingStandard),
          stepMilliseconds: Object.fromEntries(Object.entries(r.stepWork).map(([id, v]) => [id, subtractWorkload(BigInt(String((source.stepMilliseconds as Prisma.JsonObject)?.[id] || v.full)), BigInt(v.remaining))!.toString()])),
        } });
      }
      if (b.scheduleState === 'DEFERRED') {
        // Approved pre-pause backfill can finish more work while the batch is
        // deferred. Keep that delta in its source week before allocating again.
        const slots = b.weekSlots;
        const delta = (total: bigint | null, rest: bigint | null, field: 'plannedMilliseconds' | 'standardMilliseconds') =>
          total === null || rest === null || slots.some(s => s[field] === null) ? 0n :
          (total - rest - slots.reduce((n,s) => n + (s[field] || 0n), 0n) > 0n ? total - rest - slots.reduce((n,s) => n + (s[field] || 0n), 0n) : 0n);
        const stepValues = { ...(source.stepMilliseconds as Prisma.JsonObject || {}) };
        for (const [id, v] of Object.entries(r.stepWork)) {
          const extra = BigInt(v.full) - BigInt(v.remaining) - slots.reduce((n,s) => n + BigInt(String((s.stepMilliseconds as Prisma.JsonObject)?.[id] || 0)), 0n);
          if (extra > 0n) stepValues[id] = (BigInt(String(stepValues[id] || 0)) + extra).toString();
        }
        await tx.productionPlanWeekSlot.update({where:{id:source.id},data:{
          quantity: { increment: Math.max(0, b.quantity - r.remainingQuantity - slots.reduce((n,s) => n+s.quantity,0)) },
          ...(source.plannedMilliseconds !== null ? {plannedMilliseconds:{increment:delta(r.planned,r.remainingPlanned,'plannedMilliseconds')}} : {}),
          ...(source.standardMilliseconds !== null ? {standardMilliseconds:{increment:delta(r.standard,r.remainingStandard,'standardMilliseconds')}} : {}),
          stepMilliseconds: stepValues as Prisma.InputJsonObject,
        }});
      }
      const root = b.workOrder!, pause = root.productionPause as Prisma.JsonObject | null;
      await tx.dailyProcessTask.updateMany({ where: { workOrder: { OR: [{ id: root.id }, { rootWorkOrderId: root.id }] },
        workDate: { gte: productionPlanningDateBoundary(now) }, status: { notIn: ['COMPLETED', 'CARRIED_OVER', 'CANCELLED'] } },
        data: { productionSuspendedAt: now, version: { increment: 1 } } });
      await tx.productionCarryover.updateMany({ where: { productionPlanBatchId: b.id, status: 'ACTIVE' }, data: { status: 'DISMISSED' } });
      const holdKey = `week-schedule:${b.id}`;
      if (input.action === 'defer') {
        await tx.productionPlanBatch.update({ where: { id: b.id }, data: { scheduleState: 'DEFERRED', scheduleReason: reason, deferredAt: now, scheduleVersion: { increment: 1 } } });
        await tx.productionPlanBatchHold.upsert({ where: { dedupeKey: holdKey }, create: { batchId: b.id, workOrderId: root.id, dedupeKey: holdKey, holdType: 'WEEK_SCHEDULE', reasonCode: 'MANUAL_DEFER', sourceType: 'PLANNING', status: 'ACTIVE', reason, frozenById: actor.id },
          update: { status: 'ACTIVE', reason, frozenAt: now, frozenById: actor.id, resolvedAt: null, resolvedById: null, version: { increment: 1 } } });
        await tx.workOrder.update({ where: { id: root.id }, data: { planActive: false, productionControlVersion: { increment: 1 },
          ...(!root.productionPausedAt ? { productionPausedAt: now, productionPause: { source: 'WEEK_SCHEDULE', reason, category: 'material', pausedBy: actor.displayName || actor.username, accumulatedMilliseconds: Number(pause?.accumulatedMilliseconds || 0) } } : {}) } });
      } else {
        const target = editableProductionPlanningWeek(input.targetWeek)!;
        const doneAt = new Date(`${preview.completionDate}T12:00:00+08:00`);
        const targetSlot = await tx.productionPlanWeekSlot.findUnique({ where: { batchId_weekStartDate: { batchId: b.id, weekStartDate: target.start } } });
        const sum = (a: bigint | null | undefined, n: bigint | null) => n === null || a === null ? null : (a || 0n) + n;
        const data = { quantity: (targetSlot?.quantity || 0) + r.remainingQuantity,
          plannedMilliseconds: sum(targetSlot?.plannedMilliseconds, r.remainingPlanned), standardMilliseconds: sum(targetSlot?.standardMilliseconds, r.remainingStandard), completionDate: doneAt,
          stepMilliseconds: Object.fromEntries(Object.entries(r.stepWork).map(([id, v]) => [id, (BigInt(String((targetSlot?.stepMilliseconds as Prisma.JsonObject)?.[id] || '0')) + BigInt(v.remaining)).toString()])) };
        await tx.productionPlanWeekSlot.upsert({ where: { batchId_weekStartDate: { batchId: b.id, weekStartDate: target.start } },
          create: { ...data, batchId: b.id, weekStartDate: target.start, weekEndDate: target.end }, update: data });
        await tx.productionPlanBatch.update({ where: { id: b.id }, data: { scheduleState: 'ACTIVE', scheduleReason: reason, deferredAt: null, scheduleVersion: { increment: 1 },
          weekStartDate: target.start, weekEndDate: target.end, plannedCompletionDate: doneAt, estimatedCompletionDate: doneAt,
          planBaselineDate: b.planBaselineDate || b.plannedCompletionDate, releaseState: chinaDate(target.start) === currentWeek ? 'active' : 'preparation' } });
        await tx.productionPlanBatchHold.updateMany({ where: { dedupeKey: holdKey, status: 'ACTIVE' }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: actor.id, version: { increment: 1 } } });
        await tx.workOrder.updateMany({ where: { OR: [{ id: root.id }, { rootWorkOrderId: root.id }], deletedAt: null }, data: {
          weekStartDate: target.start, weekEndDate: target.end, plannedAt: doneAt, estimatedCompletionAt: doneAt, planActive: chinaDate(target.start) === currentWeek,
        } });
        await tx.workOrder.update({ where: { id: root.id }, data: { productionControlVersion: { increment: 1 },
          ...(pause?.source === 'WEEK_SCHEDULE' && root.productionPausedAt ? { productionPausedAt: null, productionPause: { ...pause, resumedAt: now.toISOString(), resumedBy: actor.displayName || actor.username,
            accumulatedMilliseconds: Number(pause.accumulatedMilliseconds || 0) + now.getTime() - root.productionPausedAt.getTime() } } : {}) } });
      }
      await tx.productionPlanChange.create({ data: { planOrderId: b.planOrderId, batchId: b.id, action: `week_${input.action}`, reason, actorId: actor.id,
        beforeData: json({ week: chinaDate(b.weekStartDate), state: b.scheduleState }), afterData: json(preview.rows.find(row => row.id === b.id)),
        impactData: json({ completionDate: preview.completionDate, actualLaborUnchanged: true, resourcesUnchanged: true, dailyAssignmentsSuspended: true }) } });
    }
    const result = json({ count: batches.length, action: input.action, targetWeek: preview.targetWeek });
    await tx.productionPlanWeekCommand.create({ data: { key, hash, result } });
    return result;
  }, { timeout: 60000, maxWait: 15000 });
}
