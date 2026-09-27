import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { chinaDate, chinaWeekRange } from '../lib/production-planning';
import { previewPlanningWeek, commitPlanningWeek, type WeekCommandInput } from '../lib/planning-week-service';
import { assertProductionMayBeScheduled, assertProductionMayRun } from '../lib/production-pause-guard';
import { readMaterialOrder, mutateMaterialOrder } from '../lib/material-order-service';
import { loadPlanningRows } from '../lib/planning-reads';
import { reconcileProductionCarryovers } from '../lib/production-carryovers';
import { refreshPlanningWeekTime } from '../lib/planning-week-time';
const skip = process.env.RUN_DB_INTEGRATION !== '1';
test('weekly membership: defer, partial operations, idempotent rejoin, atomic transfer and retained resources', {skip,timeout:120000},async()=>{
  const marker='week-membership-'+randomUUID();
  const actor=await prisma.user.create({data:{username:marker,displayName:'计划验证',passwordHash:'test-only'}});
  const now=chinaWeekRange(new Date()), next=chinaWeekRange(new Date(now.start.getTime()+7*86400000));
  const work=await prisma.workOrder.create({data:{code:marker,productName:marker,specification:marker,stage:'frontend',status:'processing',planType:'managed_plan',planActive:true,
    productionTargetQty:10,completedQty:'4',weekStartDate:now.start,weekEndDate:now.end,
    processRoute:{create:{templateName:marker,templateVersion:1,status:'in_progress',version:1,steps:{create:[1,2].map(position=>({position,sequenceGroup:position,processCode:marker+position,processName:'工序'+position,stageGroup:'frontend',status:position===1?'completed':'current',timeBasis:'per_unit',standardSource:'test',standardMillisecondsPerUnit:60000,unitsPerProduct:1,countsForEfficiency:true,inputQty:10,processedQty:position===1?10:4,goodOutputQty:position===1?10:4}))}}},
    materialTask:{create:{status:'completed',completedAt:new Date(),completedById:actor.id}},
  }});
  const order=await prisma.productionPlanOrder.create({data:{sourceOrderNo:marker,sourceLineNo:1,customerName:'测试客户',productName:marker,specification:marker,orderQuantity:10,planningUnitMilliseconds:120000,orderDate:now.start,customerDueDate:next.end}});
  const batch=await prisma.productionPlanBatch.create({data:{planOrderId:order.id,batchNo:1,quantity:10,weekStartDate:now.start,weekEndDate:now.end,plannedCompletionDate:now.end,unitMillisecondsSnapshot:120000,totalMillisecondsSnapshot:1200000n,releaseState:'active',workOrderId:work.id}});
  const task=await prisma.warehouseMaterialTask.findUniqueOrThrow({where:{workOrderId:work.id}});
  const keys:string[]=[];
  const command=async(input:Partial<WeekCommandInput>&{action:WeekCommandInput['action']})=>{
    const payload={batchIds:[batch.id],reason:'测试周计划变更',...input};
    const preview=await previewPlanningWeek(payload);
    const requestKey=marker+'-'+randomUUID(); keys.push(requestKey);
    const request={...payload,fingerprint:preview.fingerprint,requestKey};
    await commitPlanningWeek(request,actor);return {request,preview};
  };
  try {
    const before=await prisma.workOrder.findUniqueOrThrow({where:{id:work.id}});
    const deferred=await command({action:'defer'});
    assert.equal(deferred.preview.rows[0].remainingPlanned,'360000');
    assert.equal((await readMaterialOrder(task.id)).state,'READY');
    assert.equal((await prisma.workOrder.findUniqueOrThrow({where:{id:work.id}})).completedQty,before.completedQty);
    await assert.rejects(prisma.$transaction(tx=>assertProductionMayBeScheduled(tx,work.id)),/冻结|暂停/);
    await assert.rejects(prisma.$transaction(tx=>assertProductionMayRun(tx,work.id)),/冻结|暂停/);
    let slots=await prisma.productionPlanWeekSlot.findMany({where:{batchId:batch.id}});
    assert.equal(slots[0].quantity,4);assert.equal(slots[0].plannedMilliseconds,840000n);
    await prisma.$transaction(tx=>reconcileProductionCarryovers(tx,{targetWeekStart:next.start,actorId:actor.id}));
    assert.equal(await prisma.productionCarryover.count({where:{productionPlanBatchId:batch.id,status:'ACTIVE'}}),0,'deferred work is not automatically carried into the next week');
    const resumed=await command({action:'join',targetWeek:chinaDate(now.start)});
    await commitPlanningWeek(resumed.request,actor);
    slots=await prisma.productionPlanWeekSlot.findMany({where:{batchId:batch.id}});
    assert.equal(slots[0].plannedMilliseconds,1200000n,'replay never doubles restored hours');
    assert.equal((await prisma.workOrder.findUniqueOrThrow({where:{id:work.id}})).productionPausedAt,null);
    await command({action:'move',targetWeek:chinaDate(next.start)});
    slots=await prisma.productionPlanWeekSlot.findMany({where:{batchId:batch.id},orderBy:{weekStartDate:'asc'}});
    assert.equal(slots.length,2);assert.deepEqual(slots.map(s=>s.plannedMilliseconds),[840000n,360000n]);
    assert.equal(slots.reduce((n,s)=>n+s.quantity,0),10);
    assert.equal((await readMaterialOrder(task.id)).state,'READY','moving week cannot reopen confirmed materials');
    assert.equal(chinaDate((await prisma.productionPlanOrder.findUniqueOrThrow({where:{id:order.id}})).customerDueDate),chinaDate(next.end));
    const source=await loadPlanningRows('week',new Date(chinaDate(now.start)+'T00:00:00+08:00'));
    assert.equal(source.orders.find(o=>o.id===order.id)?.batches[0].retainedWeek,true);
    assert.equal(source.orders.find(o=>o.id===order.id)?.batches[0].weekPlanMilliseconds,'840000');
    const target=await loadPlanningRows('week',new Date(chinaDate(next.start)+'T00:00:00+08:00'));
    assert.equal(target.orders.find(o=>o.id===order.id)?.batches[0].weekPlanMilliseconds,'360000');
    await prisma.$transaction(async tx=>{
      await tx.productionPlanBatch.update({where:{id:batch.id},data:{unitMillisecondsSnapshot:240000,totalMillisecondsSnapshot:2400000n}});
      await refreshPlanningWeekTime(tx,batch.id,1200000n);
    });
    slots=await prisma.productionPlanWeekSlot.findMany({where:{batchId:batch.id},orderBy:{weekStartDate:'asc'}});
    assert.deepEqual(slots.map(s=>s.plannedMilliseconds),[1680000n,720000n],'editing imported time keeps historical and target allocations in proportion');
    // Root progress changes between preview and commit must reject the stale command.
    const stale=await previewPlanningWeek({action:'defer',batchIds:[batch.id]});
    await prisma.workOrder.update({where:{id:work.id},data:{completedQty:'5'}});
    await assert.rejects(commitPlanningWeek({action:'defer',batchIds:[batch.id],fingerprint:stale.fingerprint,reason:'过期预览',requestKey:marker+'stale'},actor),/已变化/);
    await prisma.workOrder.update({where:{id:work.id},data:{completedQty:'4',productionPausedAt:new Date(),productionPause:{source:'MANUAL',reason:'质量暂停'}}});
    await command({action:'defer'});await command({action:'join',targetWeek:chinaDate(next.start)});
    assert.equal((await prisma.workOrder.findUniqueOrThrow({where:{id:work.id}})).productionPause && ((await prisma.workOrder.findUniqueOrThrow({where:{id:work.id}})).productionPause as {source:string}).source,'MANUAL','week restore preserves an independent pause');
    assert.equal(await prisma.productionPlanBatch.count({where:{workOrderId:work.id}}),1);
  } finally {
    await prisma.productionPlanWeekCommand.deleteMany({where:{key:{in:keys}}});
    await prisma.productionPlanOrder.delete({where:{id:order.id}});
    await prisma.workOrder.delete({where:{id:work.id}});
    await prisma.user.delete({where:{id:actor.id}});
  }
});

test('warehouse direct confirmation requires no shipment, supports partial and rejected arrivals, and closes atomically',{skip,timeout:60000},async()=>{
  const marker='direct-receipt-'+randomUUID();
  const actor=await prisma.user.create({data:{username:marker,displayName:'仓库验证',passwordHash:'test-only'}});
  const work=await prisma.workOrder.create({data:{code:marker,productName:marker,stage:'not_issued',productionTargetQty:10}});
  let order=await readMaterialOrder((await prisma.warehouseMaterialTask.create({data:{workOrderId:work.id}})).id);
  const change=async(action:string,data:Record<string,unknown>={})=>order=await mutateMaterialOrder(order.id,{action,version:order.version,requestKey:randomUUID(),workspace:'warehouse',...data},actor.id,true);
  try{
    await change('report_exception',{materialModel:'A',supplySource:'PURCHASED',shortageQuantity:10,unit:'个',exceptionType:'shortage'});
    const id=order.events[0].id;
    await assert.rejects(change('record_shipment',{exceptionId:id,quantity:10}),/物料追踪/);
    await change('confirm_arrival',{exceptionId:id,quantity:4,acceptedQuantity:3,note:'错料一件'});
    assert.equal(order.events[0].usable,3);assert.equal(order.events[0].missing,7);assert.equal(order.events[0].pending,0);
    await assert.rejects(change('confirm_arrival',{exceptionId:id,quantity:2,confirmComplete:true}),/异常|缺料/);
    order=await readMaterialOrder(order.id);assert.equal(order.events[0].usable,3,'whole-kit failure rolls back receipt too');
    await change('confirm_arrival',{exceptionId:id,quantity:7,confirmComplete:true});assert.equal(order.state,'READY');
    assert.equal(order.events[0].arrivals.length,2);assert.equal(order.events[0].arrivals.every(a=>a.status==='VERIFIED'),true);
    await change('report_exception',{materialModel:'B',supplySource:'CUSTOMER',unit:'个',exceptionType:'shortage'});
    assert.equal(order.state,'SHORTAGE','new shortage revokes readiness');
    await change('confirm_arrival',{exceptionId:order.events[1].id,itemComplete:true,confirmComplete:true});assert.equal(order.state,'READY');
  }finally{await prisma.workOrder.delete({where:{id:work.id}});await prisma.user.delete({where:{id:actor.id}});}
});
