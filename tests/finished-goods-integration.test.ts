import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { mutateFinishedGoods, loadFinishedGoods } from '../lib/finished-goods-service';
import { fgStock, physicalStock, type FgInput } from '../lib/finished-goods-domain';

const { createFixture } = require('../scripts/seed-finished-goods-smoke.cjs');
const skip = process.env.RUN_DB_INTEGRATION !== '1';
test('finished goods: physical receipt, holds, concurrency, dispatch, return, rework and source guard', { skip }, async t => {
  process.env.FINISHED_GOODS_QA_ALLOW = 'disposable-finished-goods-runtime';
  const fixture = await createFixture(prisma, 7);
  const actor = fixture.user;
  const lot = (index: number) => prisma.fgLot.findUniqueOrThrow({ where: { id: fixture.lots[index].id } });
  const perform = (body: FgInput, key = randomUUID()) => mutateFinishedGoods(body, actor, key);
  async function stock(index: number, action: string, quantity: number, extra: FgInput = {}) {
    const current = await lot(index);
    return perform({ action, lotId: current.id, version: current.version, quantity, reason:'仓库验收',checked:true,...extra });
  }
  await t.test('automatic intake is pending only and source writes are idempotent',async()=>{
    const current=await lot(0);assert.deepEqual(fgStock(current),{pending:20,available:0,reserved:0,held:0,blocked:0});
    await prisma.processQuantityMovement.update({where:{id:fixture.lots[0].movementId},data:{quantity:20}});
    assert.equal(await prisma.fgLot.count({where:{movementId:fixture.lots[0].movementId}}),1);
    const current1=await lot(1); const input={action:'RECEIVE',lotId:current1.id,version:current1.version,quantity:10,checked:true};const key=randomUUID();
    await Promise.all([perform(input,key),perform(input,key)]);assert.equal((await lot(1)).available,10);
    await assert.rejects(perform({...input,quantity:11},key),/操作编号/);
  });
  await t.test('partial receipt plus hold conserve physical inventory and reject stale writes',async()=>{
    await stock(0,'RECEIVE',15); const previous=await lot(0);
    await stock(0,'HOLD',5,{dueDate:fixture.date});
    assert.equal(physicalStock(await lot(0)),15);assert.equal((await lot(0)).held,5);
    await assert.rejects(perform({action:'HOLD',lotId:previous.id,version:previous.version,quantity:1,reason:'stale'}),/更新/);
    await stock(0,'RELEASE_HOLD',2);assert.equal((await lot(0)).available,12);
    await assert.rejects(stock(0,'UNRECEIVE',13),/库存不足/);
  });
  let shipmentId=''; let lineId='';
  await t.test('tracking save does not ship; quick partial shipping creates receipt and shipment with exact projection',async()=>{
    const current=await lot(2); const input={lotId:current.id,version:current.version,quantity:30,method:'COURIER',carrier:'顺丰',recipient:'收货测试员',address:'杭州市验收地址',plannedDate:fixture.date};
    const saved=await perform({...input,action:'SAVE_DRAFT'});shipmentId=String(saved.id);
    assert.equal((await lot(2)).available,0);assert.equal((await lot(2)).pending,60);assert.equal(await prisma.shipmentEvent.count({where:{item:{workOrderId:current.workOrderId!}}}),0);
    const result=await perform({...input,action:'QUICK_SHIP',shipmentId,shipmentVersion:saved.version,receive:true,checked:true});assert.equal(result.shipped,true);
    const after=await lot(2);assert.equal(after.pending,30);assert.equal(physicalStock(after),0);
    const lines=await prisma.fgShipmentLine.findMany({where:{shipmentId}});lineId=lines[0].id;
    assert.equal((await prisma.shipmentEvent.findUniqueOrThrow({where:{idempotencyKey:`FG:${lineId}`}})).quantity,30);
    assert.equal(await prisma.fgLedger.count({where:{lotId:current.id,kind:{in:['RECEIVE','SHIP']}}}),2);
    const snap=await loadFinishedGoods({q:fixture.marker,date:fixture.date});assert.equal(snap.counts.missing,1);
    const header=await prisma.fgShipment.findUniqueOrThrow({where:{id:shipmentId}});
    await perform({action:'SAVE_LOGISTICS',shipmentId,shipmentVersion:header.version,waybills:['SF-QA-1','SF-QA-2'],carrier:'顺丰'});
    assert.equal((await loadFinishedGoods({q:fixture.marker,date:fixture.date})).counts.missing,0);
  });
  await t.test('production cannot be withdrawn after receipt/shipment',async()=>{
    await assert.rejects(prisma.processQuantityMovement.update({where:{id:fixture.lots[2].movementId},data:{voidedAt:new Date()}}),/FG_SOURCE_IN_USE/);
    await prisma.processQuantityMovement.update({where:{id:fixture.lots[3].movementId},data:{voidedAt:new Date()}});
    assert.equal((await lot(3)).pending,0);
    const original=await prisma.processQuantityMovement.findUniqueOrThrow({where:{id:fixture.lots[2].movementId}});
    await assert.rejects(prisma.processQuantityMovement.create({data:{completionId:original.completionId,workOrderId:original.workOrderId,sourceStepId:original.sourceStepId,type:'REVERSAL',quantity:60,sourceSequenceGroup:1,reversalOfId:original.id,idempotencyKey:randomUUID()}}),/FG_SOURCE_IN_USE/);
    const pendingOriginal=await prisma.processQuantityMovement.findUniqueOrThrow({where:{id:fixture.lots[6].movementId}});
    const reversal=await prisma.processQuantityMovement.create({data:{completionId:pendingOriginal.completionId,workOrderId:pendingOriginal.workOrderId,sourceStepId:pendingOriginal.sourceStepId,type:'REVERSAL',quantity:5,sourceSequenceGroup:1,reversalOfId:pendingOriginal.id,idempotencyKey:randomUUID()}});
    assert.equal((await lot(6)).pending,55);
    await prisma.processQuantityMovement.delete({where:{id:reversal.id}});assert.equal((await lot(6)).pending,60);
  });
  await t.test('two simultaneous shipments cannot double consume stock',async()=>{
    await stock(4,'RECEIVE',20);const current=await lot(4);
    const input={action:'QUICK_SHIP',lotId:current.id,version:current.version,quantity:20,method:'PICKUP',handoverName:'客户张工',plannedDate:fixture.date,checked:true};
    const results=await Promise.allSettled([perform(input),perform(input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await lot(4)).available,0);
  });
  await t.test('return is isolated, bounded by original shipment, then can be reworked and released',async()=>{
    const returned=await perform({action:'RETURN',lineId,quantity:5,checked:true,reason:'客户退回核查'});const returnedId=String(returned.id);
    let returnedLot=await prisma.fgLot.findUniqueOrThrow({where:{id:returnedId}});assert.equal(returnedLot.blocked,5);assert.equal(returnedLot.available,0);
    await assert.rejects(perform({action:'RETURN',lineId,quantity:26,checked:true,reason:'超量退货'}),/超过/);
    await perform({action:'REWORK_OUT',lotId:returnedId,version:returnedLot.version,quantity:3,bucket:'blocked',destination:'返工工位A',reason:'修复',checked:true});
    const rework=await prisma.fgRework.findFirstOrThrow({where:{lotId:returnedId}});
    const back=await perform({action:'REWORK_RETURN',reworkId:rework.id,quantity:2,reason:'修复回库',checked:true});
    const backLot=await prisma.fgLot.findUniqueOrThrow({where:{id:String(back.id)}});assert.equal(backLot.blocked,2);
    await perform({action:'UNBLOCK',lotId:backLot.id,version:backLot.version,quantity:2,reason:'复核合格'});
    await perform({action:'REWORK_SCRAP',reworkId:rework.id,quantity:1,reason:'无法修复',checked:true});
    assert.equal((await prisma.fgRework.findUniqueOrThrow({where:{id:rework.id}})).scrapped,1);
    returnedLot=await prisma.fgLot.findUniqueOrThrow({where:{id:returnedId}});assert.equal(returnedLot.blocked,2);
  });
  await t.test('reserve/release/cancel and batch atomic failure preserve balances',async()=>{
    await stock(5,'RECEIVE',40);const current=await lot(5);
    const draft=await perform({action:'SAVE_DRAFT',lotId:current.id,version:current.version,quantity:15,plannedDate:fixture.date,method:'PICKUP',handoverName:'验收员'});
    await perform({action:'RESERVE',shipmentId:draft.id,shipmentVersion:draft.version});assert.equal((await lot(5)).reserved,15);
    let header=await prisma.fgShipment.findUniqueOrThrow({where:{id:String(draft.id)}});
    await perform({action:'UNRESERVE',shipmentId:header.id,shipmentVersion:header.version});assert.equal((await lot(5)).available,40);
    header=await prisma.fgShipment.findUniqueOrThrow({where:{id:header.id}});await perform({action:'CANCEL_DRAFT',shipmentId:header.id,shipmentVersion:header.version});
    const current6=await lot(6);const before5=await lot(5);
    await assert.rejects(perform({action:'BATCH_SHIP',checked:true,entries:[{lotId:before5.id,version:before5.version,quantity:10,method:'PICKUP',handoverName:'验收员',plannedDate:fixture.date,receive:true},{lotId:current6.id,version:current6.version,quantity:99999,method:'PICKUP',handoverName:'验收员',plannedDate:fixture.date,receive:true}]}));
    assert.deepEqual(fgStock(await lot(5)),fgStock(before5));
  });
  await t.test('public stock is allocated once and cannot be mixed across customers',async()=>{
    const created=await perform({action:'OPENING_ADD',productName:'备货产品',specification:'V1',quantity:10,ownerType:'PUBLIC',reason:'点收盘盈',checked:true});
    const publicLot=await prisma.fgLot.findUniqueOrThrow({where:{id:String(created.id)}});
    const allocated=await perform({action:'ALLOCATE',lotId:publicLot.id,version:publicLot.version,quantity:6,customerName:'专属客户',reason:'订单分配'});
    assert.equal((await prisma.fgLot.findUniqueOrThrow({where:{id:publicLot.id}})).available,4);
    const customerLot=await prisma.fgLot.findUniqueOrThrow({where:{id:String(allocated.id)}});
    await assert.rejects(perform({action:'SAVE_DRAFT',lotId:customerLot.id,version:customerLot.version,quantity:1,customerName:'另一客户'}),/同一客户/);
    await perform({action:'QUICK_SHIP',lotId:customerLot.id,version:customerLot.version,quantity:4,method:'PICKUP',handoverName:'专属客户收货员',checked:true});
    assert.equal((await prisma.fgLot.findUniqueOrThrow({where:{id:customerLot.id}})).available,2);
  });
  await t.test('multi-line shipment preserves all lines and rejects duplicate active drafts',async()=>{
    const first=await lot(0);const second=await lot(5);
    const draft=await perform({action:'SAVE_DRAFT',lines:[{lotId:first.id,version:first.version,quantity:2},{lotId:second.id,version:second.version,quantity:3}],customerName:first.customerName,method:'PICKUP',handoverName:'合单验收员'}).catch(async error=>{
      // Fixture customers differ; create the second lot explicitly for the same customer.
      assert.match(error.message,/同一客户/);
      const added=await perform({action:'OPENING_ADD',productName:'合单产品',specification:'MERGE-V1',quantity:3,customerName:first.customerName,reason:'合单验收实物',checked:true});
      const same=await prisma.fgLot.findUniqueOrThrow({where:{id:String(added.id)}});
      return perform({action:'SAVE_DRAFT',lines:[{lotId:first.id,version:first.version,quantity:2},{lotId:same.id,version:same.version,quantity:3}],method:'PICKUP',handoverName:'合单验收员',note:'保留原出货备注'});
    });
    await assert.rejects(perform({action:'SAVE_DRAFT',lotId:first.id,version:first.version,quantity:1}),/已有未完成/);
    await assert.rejects(perform({action:'QUICK_SHIP',shipmentId:draft.id,shipmentVersion:draft.version,lotId:first.id,version:first.version,quantity:2,checked:true}),/合单/);
    await perform({action:'SHIP',shipmentId:draft.id,shipmentVersion:draft.version,checked:true});
    const shipped=await prisma.fgShipment.findUniqueOrThrow({where:{id:String(draft.id)},include:{lines:true}});
    assert.equal(shipped.lines.length,2);assert.equal(shipped.lines.reduce((sum,line)=>sum+line.quantity,0),5);
    assert.equal(shipped.note,'保留原出货备注');
    assert.equal((await lot(0)).available,first.available-2);
  });
  await t.test('closed and wrong-date dispatch batches cannot accept actual shipments',async()=>{
    const batch=await perform({action:'CREATE_BATCH',date:'2020-01-02',name:'历史批次'});
    const current=await lot(1);
    await assert.rejects(perform({action:'QUICK_SHIP',lotId:current.id,version:current.version,quantity:1,method:'PICKUP',handoverName:'测试',batchId:batch.id,plannedDate:'2020-01-02',checked:true}),/今天/);
    await perform({action:'CLOSE_BATCH',batchId:batch.id});
    await assert.rejects(perform({action:'SAVE_DRAFT',lotId:current.id,version:current.version,quantity:1,batchId:batch.id,plannedDate:'2020-01-02'}),/封批/);
    assert.deepEqual(fgStock(await lot(1)),fgStock(current));
  });
  await t.test('a real final process completion enters finished goods immediately',async()=>{
    const source=fixture.lots[6];
    await prisma.processQuantityMovement.update({where:{id:source.movementId},data:{voidedAt:new Date()}});
    await prisma.processCompletion.update({where:{id:source.completionId},data:{voidedAt:new Date(),voidedById:fixture.actor.id,voidReason:'隔离验收重置',coverageStatus:'VOIDED'}});
    await prisma.workOrder.update({where:{id:source.workOrderId},data:{stage:'backend',completedQty:'0'}});
    await prisma.workOrderProcessRoute.update({where:{id:source.routeId},data:{status:'in_progress',completedAt:null,confirmedById:fixture.actor.id}});
    await prisma.workOrderProcessStep.update({where:{id:source.stepId},data:{status:'current',processedQty:0,goodOutputQty:0,releasedGoodQty:0,completedAt:null}});
    const completed=await completeProcessStep({routeId:source.routeId,stepId:source.stepId,processedQty:10,defectQty:0,workDate:fixture.date,expectedRouteVersion:0,idempotencyKey:randomUUID(),userId:fixture.actor.id,actor:fixture.actor.displayName});
    const produced=await prisma.processQuantityMovement.findFirstOrThrow({where:{completionId:completed.completionId,type:'FINISHED_GOOD',voidedAt:null}});
    assert.equal((await prisma.fgLot.findUniqueOrThrow({where:{movementId:produced.id}})).pending,10);
  });
  // Preserve disposable fixtures for visual acceptance; no production data is targeted.
  await t.test('historical migration nets reversals and allocates old shipments FIFO without fabricating physical stock',async()=>{
    const legacy=await createFixture(prisma,2);const source=legacy.lots[0];
    const original=await prisma.processQuantityMovement.findUniqueOrThrow({where:{id:source.movementId}});
    const extra=await prisma.processQuantityMovement.create({data:{completionId:original.completionId,workOrderId:original.workOrderId,sourceStepId:original.sourceStepId,type:'FINISHED_GOOD',quantity:15,sourceSequenceGroup:1,idempotencyKey:randomUUID(),createdAt:new Date(original.createdAt.getTime()+1000)}});
    await prisma.processQuantityMovement.create({data:{completionId:original.completionId,workOrderId:original.workOrderId,sourceStepId:original.sourceStepId,type:'REVERSAL',quantity:5,sourceSequenceGroup:1,reversalOfId:original.id,idempotencyKey:randomUUID()}});
    const date=new Date(`${legacy.date}T00:00:00Z`);
    const plan=await prisma.dailyShipmentPlan.upsert({where:{shipDate:date},create:{shipDate:date,createdById:legacy.actor.id,updatedById:legacy.actor.id},update:{}});
    const batch=await prisma.productionPlanBatch.findFirstOrThrow({where:{workOrderId:source.workOrderId}});
    const item=await prisma.dailyShipmentPlanItem.create({data:{planId:plan.id,productionPlanBatchId:batch.id,workOrderId:source.workOrderId,plannedQuantity:30,plannedShipAt:date,sourceSnapshot:{},createdById:legacy.actor.id,updatedById:legacy.actor.id}});
    const old=await prisma.shipmentEvent.create({data:{itemId:item.id,eventType:'SHIPMENT',quantity:22,shippedAt:date,actorId:legacy.actor.id,idempotencyKey:randomUUID()}});
    await prisma.shipmentEvent.create({data:{itemId:item.id,eventType:'REVERSAL',quantity:3,reversalOfEventId:old.id,reason:'历史退回核对',shippedAt:date,actorId:legacy.actor.id,idempotencyKey:randomUUID()}});
    await prisma.processCompletion.update({where:{id:legacy.lots[1].completionId},data:{voidedAt:new Date(),voidedById:legacy.actor.id,voidReason:'历史撤回',coverageStatus:'VOIDED'}});
    const migration=readFileSync('prisma/migrations/20260915060001_finished_goods_source/migration.sql','utf8');
    const backfill=migration.slice(migration.indexOf('WITH old_ship'),migration.indexOf('CREATE FUNCTION')).trim().replace(/;$/, ' ON CONFLICT ("movementId") DO NOTHING;');
    await prisma.$transaction(async tx=>{
      const ids=(await tx.fgLot.findMany({where:{workOrderId:{in:legacy.lots.map((l:{workOrderId:string})=>l.workOrderId)}},select:{id:true}})).map(l=>l.id);
      await tx.fgLedger.deleteMany({where:{lotId:{in:ids}}});await tx.fgLot.deleteMany({where:{id:{in:ids}}});
      await tx.$executeRawUnsafe(backfill);
    });
    const first=await prisma.fgLot.findUniqueOrThrow({where:{movementId:source.movementId}});const second=await prisma.fgLot.findUniqueOrThrow({where:{movementId:extra.id}});
    assert.equal(first.pending,0);assert.equal(second.pending,11);assert.equal(physicalStock(second),0);assert.equal(second.openingReview,true);
    assert.equal(await prisma.fgLot.count({where:{movementId:legacy.lots[1].movementId}}),0);
    await perform({action:'OPENING_RECONCILE',lotId:second.id,version:second.version,quantity:8,reason:'实盘8件',checked:true});
    const received=await prisma.fgLot.findUniqueOrThrow({where:{id:second.id}});assert.equal(received.available,8);assert.equal(received.pending,0);assert.equal(received.openingReview,false);
  });
});
