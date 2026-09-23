import { Prisma } from '@prisma/client';
import { chinaDateKey } from './china-date';
import { SamplePlanError, sampleDay, sampleWeek } from './sample-plan-domain';
import { synchronizeSampleWarehouse } from './sample-plan-operations';
import { sampleUnitTime } from './sample-plan-time';
import { cleanSampleText, parseOptionalSampleDate, sampleRequestHash, type SampleActor } from './sample-team';

export async function correctSamplePlan(tx: Prisma.TransactionClient, id: string, body: Record<string,unknown>, actor: SampleActor) {
  const reason = cleanSampleText(body.reason,1000);
  const mutationId = cleanSampleText(body.mutationId,100);
  if (!reason || !mutationId) throw new SamplePlanError('更正必须填写原因并携带操作编号');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sample-task:${id}`}))`;
  const hash=sampleRequestHash(body);
  const replay=await tx.operationLog.findFirst({where:{targetType:'sample_task',targetId:id,action:'correct_sample_plan',detail:{path:['mutationId'],equals:mutationId}}});
  if (replay) { if ((replay.detail as Record<string,unknown>).requestHash!==hash) throw new SamplePlanError('本次更正内容已变化，请重新打开更正窗口',409); return; }
  const task=await tx.sampleTask.findFirst({where:{id,deletedAt:null}});
  if (!task) throw new SamplePlanError('样品计划不存在',404);
  if (task.version!==Number(body.expectedVersion)) throw new SamplePlanError('计划已被修改，请刷新后更正',409);
  let before: unknown, after: unknown;
  if (body.action==='CORRECT_METADATA') {
    const changes: Prisma.SampleTaskUncheckedUpdateInput = {};
    for (const key of ['sourceOrderNo','sourceOrderLine','planRemark'] as const) if (body[key]!==undefined) changes[key]=cleanSampleText(body[key],key==='planRemark'?1000:120);
    for (const key of ['dueDate','issuedDate','plannedCompletionDate'] as const) if (body[key]!==undefined) changes[key]=parseOptionalSampleDate(body[key]);
    if (body.planWeekStartDate!==undefined) {const week=sampleWeek(body.planWeekStartDate);changes.planWeekStartDate=week?new Date(week):null;}
    if (body.unitPlannedMinutes!==undefined) {changes.unitPlannedMilliseconds=sampleUnitTime(body.unitPlannedMinutes);changes.planTimeSource=changes.unitPlannedMilliseconds===null?null:'correction';}
    if (body.sampleQuantity!==undefined) {
      const quantity=Number(body.sampleQuantity);
      if (!Number.isSafeInteger(quantity)||quantity<1||quantity>2147483647||quantity<task.completedQuantity) throw new SamplePlanError('计划数量须为正整数，且不得低于已确认完成量');
      changes.sampleQuantity=quantity;
    }
    const due = changes.dueDate===undefined?task.dueDate:changes.dueDate;
    const issued = changes.issuedDate===undefined?task.issuedDate:changes.issuedDate;
    if (due instanceof Date && issued instanceof Date && due<issued) throw new SamplePlanError('客户交期不能早于下达日期');
    before=Object.fromEntries(Object.keys(changes).map(key=>[key,(task as unknown as Record<string,unknown>)[key]])); after=changes;
    await tx.sampleTask.update({where:{id},data:{...changes,version:{increment:1},updatedById:actor.id,updatedByName:actor.name}});
    if (changes.sampleQuantity !== undefined && changes.sampleQuantity !== task.sampleQuantity && !['COMPLETED','CANCELLED'].includes(task.status)) await synchronizeSampleWarehouse(tx,id,actor,false,true);
  } else {
    const quantity=Number(body.quantity);
    if (!Number.isSafeInteger(quantity)||quantity<0||quantity>2147483647) throw new SamplePlanError('实际完成数量须为非负整数');
    const completionId=cleanSampleText(body.completionId,100);
    if (!completionId) {
      if (task.completedQuantityKnown || task.status!=='COMPLETED' || await tx.sampleCompletion.count({where:{taskId:id}}) || await tx.fgLot.count({where:{sampleTaskId:id}})) throw new SamplePlanError('该计划已有数量依据，请选择具体完成登记更正');
      if (quantity>(task.sampleQuantity||0)) throw new SamplePlanError('完成数量不能超过计划数量');
      before={completedQuantity:'历史未记录'};after={completedQuantity:quantity,stockAction:'历史数量补录，不新建库存'};
      await tx.sampleTask.update({where:{id},data:{completedQuantity:quantity,completedQuantityKnown:true,version:{increment:1},updatedById:actor.id,updatedByName:actor.name}});
    } else {
      const completion=await tx.sampleCompletion.findFirst({where:{id:completionId,taskId:id}});
      if (!completion) throw new SamplePlanError('完成登记不存在',404);
      const workDate=sampleDay(body.workDate);
      if (workDate>chinaDateKey(new Date())) throw new SamplePlanError('现场完成日期不能晚于今天');
      const total=task.completedQuantity-completion.quantity+quantity;
      if (total<0 || total>(task.sampleQuantity||0)) throw new SamplePlanError('更正后的累计完成量不能超过计划数量');
      const sourceKey=`sample:${completion.id}`;
      await tx.$queryRaw`SELECT id FROM fg_lots WHERE "sourceKey"=${sourceKey} FOR UPDATE`;
      const lot=await tx.fgLot.findUnique({where:{sourceKey},include:{lines:{include:{shipment:true}}}});
      if (!lot) throw new SamplePlanError('缺少对应成品仓记录，需要先核对仓库来源',409);
      const delta=quantity-completion.quantity;
      if (delta && (lot.reserved || lot.held || lot.blocked || lot.legacyClosedAt || lot.pending+lot.available!==completion.quantity || lot.lines.some(line=>!['CANCELLED','VOIDED'].includes(line.shipment.status)))) throw new SamplePlanError('该批已涉及发货、占用或库存调整，请先在成品仓处理关联记录后再更正数量',409);
      const beforeStock={pending:lot.pending,available:lot.available,reserved:lot.reserved,held:lot.held,blocked:lot.blocked};
      const next={...beforeStock};
      if (delta>=0) next.pending+=delta;
      else {const fromPending=Math.min(next.pending,-delta);next.pending-=fromPending;next.available-=(-delta-fromPending);}
      await tx.fgLot.update({where:{id:lot.id},data:{...next,sourceQuantity:lot.sourceQuantity+delta,productionWorkDate:new Date(workDate),version:{increment:1}}});
      await tx.fgLedger.create({data:{lotId:lot.id,kind:'SAMPLE_CORRECTION',quantity:delta,before:beforeStock,after:next,reason,reference:completion.id,actorId:actor.id,actorName:actor.name}});
      await tx.sampleCompletion.update({where:{id:completion.id},data:{quantity,workDate:new Date(workDate)}});
      const done=total===task.sampleQuantity;
      before={quantity:completion.quantity,workDate:completion.workDate,completedQuantity:task.completedQuantity,stock:beforeStock};after={quantity,workDate,completedQuantity:total,stock:next};
      await tx.sampleTask.update({where:{id},data:{completedQuantity:total,completedQuantityKnown:true,status:task.status==='CANCELLED'?'CANCELLED':done?'COMPLETED':'IN_PROGRESS',completedAt:done?task.completedAt||new Date():null,archivedAt:done?task.archivedAt||new Date():null,archivedById:done?task.archivedById||actor.id:null,archivedByName:done?task.archivedByName||actor.name:null,archiveReason:done?task.archiveReason||'更正完成登记':null,version:{increment:1},updatedById:actor.id,updatedByName:actor.name}});
    }
  }
  await tx.operationLog.create({data:{userId:actor.id,action:'correct_sample_plan',targetType:'sample_task',targetId:id,detail:JSON.parse(JSON.stringify({actor:actor.name,reason,mutationId,requestHash:hash,before,after}))}});
}
