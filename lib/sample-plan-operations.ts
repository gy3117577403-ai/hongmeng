import { createHash } from 'node:crypto';
import type { Prisma, SampleTask } from '@prisma/client';
import { assertPackageFiles } from '@/lib/quality-fixture-service';
import { fixtureSignaturesValid } from '@/lib/quality-fixture-domain';
import { packageMatchesCurrentDocuments } from '@/lib/quality-fixture-sync';
import { chinaDateKey } from '@/lib/china-date';
import { SamplePlanError, sampleCompletionQuantity, sampleDay } from '@/lib/sample-plan-domain';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };
export async function ensureSampleWarehouse(tx: Tx, task: Pick<SampleTask, 'id' | 'status' | 'dataPurpose'>) {
  if (task.dataPurpose !== 'PRODUCTION' || ['COMPLETED','CANCELLED'].includes(task.status)) return null;
  return tx.warehouseMaterialTask.upsert({ where: { sampleTaskId: task.id }, create: { sampleTaskId: task.id }, update: {} });
}
export async function assertSampleDrawingApproved(tx: Tx, task: SampleTask, bind = true) {
  if (!task.documentReviewRequired || task.dataPurpose !== 'PRODUCTION') return null;
  let pack = task.approvedPackageId
    ? await tx.qfPackage.findFirst({ where: { id: task.approvedPackageId, libraryItemId: task.drawingLibraryItemId } })
    : await tx.qfPackage.findFirst({ where: { libraryItemId: task.drawingLibraryItemId }, orderBy: { sequence: 'desc' } });
  if (pack?.status === 'SUPERSEDED' || pack?.status === 'REVOKED') pack = await tx.qfPackage.findFirst({ where: { libraryItemId: task.drawingLibraryItemId }, orderBy: { sequence: 'desc' } });
  if (!pack || pack.status !== 'APPROVED' || !fixtureSignaturesValid(pack))
    throw new SamplePlanError('图纸资料须由主管与品质双方审核通过', 409);
  if (task.approvedPackageId !== pack.id && !await packageMatchesCurrentDocuments(tx, pack))
    throw new SamplePlanError('图纸资料已经变更，请先完成当前版本审核', 409);
  await assertPackageFiles(tx, pack);
  if (bind && task.approvedPackageId !== pack.id) await tx.sampleTask.update({ where: { id: task.id }, data: { approvedPackageId: pack.id } });
  return pack.id;
}
export async function transferSampleCompletion(tx: Tx, task: SampleTask, actor: Actor, input: { mutationId: string; quantity: unknown; workDate?: unknown; note?: unknown }) {
  if (task.dataPurpose !== 'PRODUCTION') return null;
  const workDate = sampleDay(input.workDate || chinaDateKey(new Date()));
  if (workDate > chinaDateKey(new Date())) throw new SamplePlanError('现场完成日期不能晚于今天');
  const note = String(input.note || '').trim().slice(0, 1000);
  const hash = createHash('sha256').update(JSON.stringify([Number(input.quantity), workDate, note])).digest('hex');
  const prior = await tx.sampleCompletion.findUnique({ where: { taskId_mutationId: { taskId: task.id, mutationId: input.mutationId } } });
  if (prior) {
    if (prior.requestHash !== hash) throw new SamplePlanError('同一次完成登记的内容不能变更，请刷新后重试', 409);
    return prior;
  }
  const quantity = sampleCompletionQuantity(input.quantity, task.sampleQuantity, task.completedQuantity);
  const now = new Date();
  const binding = await tx.sampleTask.findUniqueOrThrow({ where: { id: task.id }, select: { approvedPackageId: true } });
  const completion = await tx.sampleCompletion.create({ data: { taskId: task.id, mutationId: input.mutationId, requestHash: hash, quantity, approvedPackageId: binding.approvedPackageId, workDate: new Date(workDate), note, actorId: actor.id, actorName: actor.name } });
  const stock = { pending: quantity, available: 0, reserved: 0, held: 0, blocked: 0 };
  const lot = await tx.fgLot.create({ data: {
    sourceKey: `sample:${completion.id}`, sourceKind: task.taskType === 'REPEAT' ? 'SAMPLE_REPEAT' : 'SAMPLE_NEW', sampleTaskId: task.id,
    workOrderCode: task.code, productKey: task.drawingLibraryItemId, productName: task.productNameSnapshot || task.specificationSnapshot,
    specification: task.specificationSnapshot, customerName: task.customerNameSnapshot, sourceQuantity: quantity, ...stock,
    note: '样品完成' + (note ? ` · ${note}` : ''), productionWorkDate: new Date(workDate), productionCompletedAt: now, transferredAt: now,
  } });
  await tx.fgLedger.create({ data: { lotId: lot.id, kind: 'SAMPLE_PENDING', quantity, before: { pending: 0, available: 0, reserved: 0, held: 0, blocked: 0 }, after: stock, reason: '样品完成', reference: task.code, actorId: actor.id, actorName: actor.name } });
  await tx.sampleTask.update({ where: { id: task.id }, data: { completedQuantity: { increment: quantity } } });
  return completion;
}
export async function completeSampleRepeat(tx: Tx, id: string, input: Record<string, unknown>, actor: Actor) {
  const mutationId = String(input.mutationId || '').slice(0, 100);
  if (!mutationId) throw new SamplePlanError('缺少本次完成登记编号，请重新打开窗口');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${id}`}))`;
  const task = await tx.sampleTask.findFirst({ where: { id, deletedAt: null } });
  if (!task) throw new SamplePlanError('样品任务不存在', 404);
  const prior = await tx.sampleCompletion.findUnique({ where: { taskId_mutationId: { taskId: id, mutationId } } });
  if (prior) { await transferSampleCompletion(tx, task, actor, { mutationId, quantity: input.quantity, workDate: input.workDate, note: input.note }); return id; }
  if (task.version !== Number(input.expectedVersion)) throw new SamplePlanError('任务已更新，请刷新后重新登记', 409);
  if (['CANCELLED','COMPLETED'].includes(task.status)) throw new SamplePlanError('任务已经结束', 409);
  if (!input.workDate) throw new SamplePlanError('请填写本次现场完成日期');
  if (task.taskType === 'NEW') {
    const [entries, photos, sections] = await Promise.all([
      tx.sampleDataEntry.findMany({where:{taskId:id,deletedAt:null},select:{reviewStatus:true}}),
      tx.samplePhoto.findMany({where:{taskId:id,deletedAt:null},select:{reviewStatus:true}}),
      tx.sampleDraftSection.findMany({where:{taskId:id},select:{payload:true,revision:true,lastSubmittedRevision:true}}),
    ]);
    const { sampleDraftSectionHasData, sampleDraftSectionHasUnsubmittedChange } = await import('./sample-team');
    if (task.activeSubmissionId || [...entries,...photos].some(row=>['DRAFT','PENDING','CHANGES_REQUESTED'].includes(row.reviewStatus)) || sections.some(sampleDraftSectionHasUnsubmittedChange)) throw new SamplePlanError('仍有采集资料待处理，请先完成整包审核',409);
    if (!entries.length && !photos.length && !sections.some(s=>sampleDraftSectionHasData(s.payload)) && input.confirmNoData !== true) throw new SamplePlanError('没有采集记录，请确认本次无需采集资料');
  }
  await assertSampleDrawingApproved(tx, task);
  const quantity = sampleCompletionQuantity(input.quantity, task.sampleQuantity, task.completedQuantity);
  if (task.dataPurpose !== 'PRODUCTION') throw new SamplePlanError('实物完成转仓仅用于正式样品计划');
  await transferSampleCompletion(tx, task, actor, { mutationId, quantity, workDate: input.workDate, note: input.note });
  const done = task.completedQuantity + quantity === task.sampleQuantity;
  await tx.sampleTask.update({ where: { id }, data: { status: done ? 'COMPLETED' : 'IN_PROGRESS', startedAt: task.startedAt || new Date(), completedAt: done ? new Date() : null, archivedAt: done ? new Date() : null, archivedById: done ? actor.id : null, archivedByName: done ? actor.name : null, archiveReason: done ? '样品完成' : null, updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } } });
  await tx.operationLog.create({ data: { userId: actor.id, action: task.taskType==='REPEAT'?'sample_repeat_complete':'sample_new_complete', targetType: 'sample_task', targetId: id, detail: { quantity, workDate: input.workDate, mutationId, completed: done, note: '样品完成' } as Prisma.InputJsonValue } });
  return id;
}
export async function synchronizeSampleWarehouse(tx: Tx, id: string, actor: Actor, cancelled: boolean, quantityChanged = false) {
  const task = await tx.warehouseMaterialTask.findUnique({ where: { sampleTaskId: id } });
  if (!task) return;
  if (cancelled) {
    await tx.warehouseMaterialExceptionCase.updateMany({ where: { warehouseTaskId: task.id, status: 'OPEN' }, data: { status: 'CANCELLED', resolutionNote: '样品计划取消', resolvedById: actor.id, resolvedAt: new Date() } });
    await tx.materialFollowUpTask.updateMany({ where: { warehouseTaskId: task.id, status: { notIn: ['RESOLVED','CANCELLED'] } }, data: { status: 'CANCELLED', latestProgress: '样品计划已取消，请核对已配物料', version: { increment: 1 } } });
  }
  if (cancelled || quantityChanged) {
    await tx.warehouseMaterialTask.update({ where: { id: task.id }, data: { requirementsConfirmed: false, status: cancelled ? 'cancelled' : task.status === 'completed' ? 'pending' : task.status, completedAt: cancelled || task.status === 'completed' ? null : task.completedAt, completedById: cancelled || task.status === 'completed' ? null : task.completedById, version: { increment: 1 }, updatedById: actor.id } });
    await tx.warehouseMaterialActivity.create({ data: { taskId: task.id, action: cancelled ? 'sample_cancelled' : 'sample_quantity_changed', actorId: actor.id, fromStatus: task.status, toStatus: cancelled ? 'cancelled' : task.status === 'completed' ? 'pending' : task.status, content: cancelled ? '样品计划取消，请核对已配物料；历史配料记录保留' : '样品计划数量已变更，请复核实物是否配齐' } });
  }
}
