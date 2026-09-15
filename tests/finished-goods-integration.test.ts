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

test('finished goods simple operations preserve stock and dispense with external shipping paperwork', { skip }, async t => {
  process.env.FINISHED_GOODS_QA_ALLOW = 'disposable-finished-goods-runtime';
  const fixture = await createFixture(prisma, 8);
  const perform = (input: FgInput, key = randomUUID()) => mutateFinishedGoods(input, fixture.user, key);
  const lot = (index: number) => prisma.fgLot.findUniqueOrThrow({where:{id:fixture.lots[index].id}});
  const emptyDetails = {recipient:'',phone:'',address:'',carrier:'',handoverName:''};
  await t.test('quick courier, pickup and delivery dispatch need no recipient or carrier', async()=>{
    for (const [index,method] of ['COURIER','PICKUP','DELIVERY'].entries()) {
      const source=await lot(index);
      const body={action:'QUICK_SHIP',lotId:source.id,version:source.version,quantity:7,method,...emptyDetails,checked:true,receive:true};
      const key=randomUUID(); const result=await perform(body,key); await perform(body,key);
      const after=await lot(index); assert.equal(after.pending,source.pending-7); assert.equal(after.available,0);
      const shipment=await prisma.fgShipment.findUniqueOrThrow({where:{id:String(result.id)}});
      assert.equal(shipment.recipient,'');assert.equal(shipment.address,'');assert.equal(shipment.carrier,'');assert.ok(shipment.shippedAt);
      assert.equal(await prisma.fgLedger.count({where:{lotId:source.id,kind:'SHIP'}}),1);
      const workbench=await loadFinishedGoods({q:source.workOrderCode,scope:'all',filter:'missing'});
      assert.equal(workbench.total,method==='COURIER'?1:0);
    }
  });
  await t.test('receipt then partial dispatch differs from quick receipt and dispatch',async()=>{
    const source=await lot(3);
    await perform({action:'RECEIVE',lotId:source.id,version:source.version,quantity:source.pending,checked:true});
    const stocked=await lot(3); const receiptTime=stocked.receivedAt;
    const draft=await perform({action:'SAVE_DRAFT',lotId:stocked.id,version:stocked.version,quantity:12,waybills:['SAVE-ONLY-'+fixture.marker],...emptyDetails,externalReference:'OTHER-SYSTEM-01'});
    assert.equal((await lot(3)).available,source.pending);assert.equal(await prisma.fgLedger.count({where:{lotId:source.id,kind:'SHIP'}}),0);
    await perform({action:'SHIP',shipmentId:draft.id,shipmentVersion:draft.version,checked:true});
    assert.equal((await lot(3)).available,source.pending-12);assert.equal((await lot(3)).pending,0);
    assert.deepEqual((await lot(3)).receivedAt,receiptTime);
    const shipped=await prisma.fgShipment.findUniqueOrThrow({where:{id:String(draft.id)}});
    await perform({action:'SAVE_LOGISTICS',shipmentId:shipped.id,shipmentVersion:shipped.version,waybills:' SF-FINAL-1\nSF-FINAL-1；SF-FINAL-2 ',externalReference:'OTHER-SYSTEM-02',note:'仅补单号'});
    const updated=await prisma.fgShipment.findUniqueOrThrow({where:{id:shipped.id}});
    assert.deepEqual(updated.waybills,['SF-FINAL-1','SF-FINAL-2']);assert.deepEqual(updated.shippedAt,shipped.shippedAt);assert.equal(updated.externalReference,'OTHER-SYSTEM-02');
    assert.equal((await lot(3)).available,source.pending-12);
  });
  await t.test('receive and hold is atomic, and batch receipt rolls back an invalid member',async()=>{
    const source=await lot(4);
    await perform({action:'RECEIVE_HOLD',lotId:source.id,version:source.version,quantity:10,reason:'备货',checked:true});
    const held=await lot(4);assert.equal(held.pending,source.pending-10);assert.equal(held.held,10);assert.equal(held.available,0);
    const next=await lot(5); const another=await lot(6);
    await assert.rejects(perform({action:'BATCH_RECEIVE',checked:true,entries:[{lotId:next.id,version:next.version,quantity:5},{lotId:another.id,version:another.version,quantity:another.pending+1}]}));
    assert.deepEqual(fgStock(await lot(5)),fgStock(next));assert.deepEqual(fgStock(await lot(6)),fgStock(another));
    await perform({action:'BATCH_RECEIVE',checked:true,entries:[{lotId:next.id,version:next.version,quantity:5},{lotId:another.id,version:another.version,quantity:6}]});
    assert.equal((await lot(5)).available,5);assert.equal((await lot(6)).available,6);
  });
  await t.test('same-customer shared waybills work, other customers require an explicit check',async()=>{
    const source=await lot(5); const waybill='SHARED-'+fixture.marker;
    const first=await perform({action:'QUICK_SHIP',lotId:source.id,version:source.version,quantity:1,waybills:[waybill],checked:true});
    const same=await perform({action:'OPENING_ADD',quantity:2,customerName:source.customerName,productName:'合包产品',specification:'SHARED',reason:'测试实物',checked:true});
    let row=await prisma.fgLot.findUniqueOrThrow({where:{id:String(same.id)}});
    await perform({action:'QUICK_SHIP',lotId:row.id,version:row.version,quantity:1,waybills:[waybill],checked:true});
    const other=await lot(6);assert.notEqual(other.customerName,source.customerName);
    const body={action:'QUICK_SHIP',lotId:other.id,version:other.version,quantity:1,waybills:[waybill],checked:true};
    await assert.rejects(perform(body),error=>Boolean(error && typeof error==='object' && 'code' in error && error.code==='FG_WAYBILL_CUSTOMER'));
    assert.deepEqual(fgStock(await lot(6)),fgStock(other));
    await perform({...body,waybillChecked:true});
    const original=await prisma.fgShipment.findUniqueOrThrow({where:{id:String(first.id)}});
    assert.ok(original.shippedAt);
  });
  await t.test('plain batches accept recipient-free dispatch and count actual waybills only',async()=>{
    const batch=await perform({action:'CREATE_BATCH',date:fixture.date,name:'精简交接'});
    const a=await lot(0),b=await lot(1);
    await perform({action:'BATCH_SHIP',checked:true,entries:[{lotId:a.id,version:a.version,quantity:1,receive:true,batchId:batch.id,method:'COURIER',waybills:['BATCH-'+fixture.marker],...emptyDetails},{lotId:b.id,version:b.version,quantity:2,receive:true,batchId:batch.id,method:'COURIER',...emptyDetails}]});
    const data=await loadFinishedGoods({view:'batches',date:fixture.date});const summary=data.batches.find(item=>item.id===batch.id)!;
    assert.equal(summary.shipped,2);assert.equal(summary.quantity,3);assert.equal(summary.waybillCount,1);assert.equal(summary.missingWaybill,1);
    const cutover=await prisma.fgCutover.findUniqueOrThrow({where:{id:'finished-goods-v2'}});
    const stock=fgStock(await lot(7));await prisma.$queryRaw`SELECT fg_initialize_cutover()::text`;
    assert.deepEqual(fgStock(await lot(7)),stock);assert.deepEqual((await prisma.fgCutover.findUniqueOrThrow({where:{id:cutover.id}})).startedAt,cutover.startedAt);
  });
});
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
    assert.equal((await prisma.fgShipment.findUniqueOrThrow({where:{id:shipmentId}})).shippedAt?.toISOString(),header.shippedAt?.toISOString());
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
    const originalReceipt = new Date('2026-01-02T03:04:00Z');
    await prisma.fgLot.update({where:{id:publicLot.id},data:{receivedAt:originalReceipt}});
    const allocated=await perform({action:'ALLOCATE',lotId:publicLot.id,version:publicLot.version,quantity:6,customerName:'专属客户',reason:'订单分配'});
    assert.equal((await prisma.fgLot.findUniqueOrThrow({where:{id:publicLot.id}})).available,4);
    const customerLot=await prisma.fgLot.findUniqueOrThrow({where:{id:String(allocated.id)}});
    assert.equal(customerLot.receivedAt?.toISOString(),originalReceipt.toISOString());
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
  await t.test('bulk removal of original and reversal nets pending correctly and still protects received goods',async()=>{
    const clean=await createFixture(prisma,2);
    for(const source of clean.lots){
      const m=await prisma.processQuantityMovement.findUniqueOrThrow({where:{id:source.movementId}});
      await prisma.processQuantityMovement.create({data:{completionId:m.completionId,workOrderId:m.workOrderId,sourceStepId:m.sourceStepId,type:'REVERSAL',quantity:5,sourceSequenceGroup:1,reversalOfId:m.id,idempotencyKey:randomUUID()}});
    }
    await prisma.processQuantityMovement.deleteMany({where:{workOrderId:clean.lots[0].workOrderId}});
    const removed=await prisma.fgLot.findUniqueOrThrow({where:{id:clean.lots[0].id}});assert.equal(removed.pending,0);assert.equal(removed.sourceQuantity,0);
    const guarded=await prisma.fgLot.findUniqueOrThrow({where:{id:clean.lots[1].id}});
    await perform({action:'RECEIVE',lotId:guarded.id,version:guarded.version,quantity:5,checked:true});
    await assert.rejects(prisma.processQuantityMovement.deleteMany({where:{workOrderId:guarded.workOrderId!}}),/FG_SOURCE_IN_USE/);
    assert.equal((await prisma.fgLot.findUniqueOrThrow({where:{id:guarded.id}})).available,5);
    assert.equal(await prisma.processQuantityMovement.count({where:{workOrderId:guarded.workOrderId!}}),2);
  });
  await t.test('partial receipts retain first receipt time and expose each event separately',async()=>{
    const source=(await createFixture(prisma,1)).lots[0];
    let current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});
    await perform({action:'RECEIVE',lotId:current.id,version:current.version,quantity:5,checked:true});
    current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});const firstTime=current.receivedAt?.toISOString();assert.ok(firstTime);
    await perform({action:'RECEIVE',lotId:current.id,version:current.version,quantity:6,checked:true});
    current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});assert.equal(current.receivedAt?.toISOString(),firstTime);assert.equal(current.available,11);
    const events=await loadFinishedGoods({q:source.workOrderCode,view:'receipts',scope:'all'});
    assert.equal(events.total,2);assert.deepEqual(events.rows.map(r=>r.quantity).sort((a,b)=>a-b),[5,6]);assert.ok(events.rows.every(r=>r.receivedAt));
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
  await t.test('first activation closes old balances once without fabricating shipments; new completion on an old order still enters stock',async()=>{
    const source=(await createFixture(prisma,1)).lots[0];
    let current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});
    await perform({action:'RECEIVE',lotId:current.id,version:current.version,quantity:15,checked:true});
    current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});
    const draft=await perform({action:'SAVE_DRAFT',lotId:current.id,version:current.version,quantity:4,method:'PICKUP',handoverName:'切换验收'});
    await perform({action:'RESERVE',shipmentId:draft.id,shipmentVersion:draft.version});
    const existingShipments=await prisma.fgShipment.findMany({where:{status:'SHIPPED'},orderBy:{id:'asc'}});
    const existingEvents=await prisma.shipmentEvent.count();
    const rollback=new Error('ROLLBACK_CUTOVER_ACCEPTANCE');
    await assert.rejects(prisma.$transaction(async tx=>{
      const before=await tx.fgLot.findMany({where:{legacyClosedAt:null}});
      await tx.fgCutover.delete({where:{id:'finished-goods-v2'}});
      await tx.$executeRawUnsafe('SELECT fg_initialize_cutover()');
      const cutoff=await tx.fgCutover.findUniqueOrThrow({where:{id:'finished-goods-v2'}});
      for(const old of before){
        const closed=await tx.fgLot.findUniqueOrThrow({where:{id:old.id}});
        assert.equal(closed.legacyQuantity,old.pending+physicalStock(old));assert.equal(closed.legacyClosedAt?.toISOString(),cutoff.startedAt.toISOString());
        assert.deepEqual(fgStock(closed),{pending:0,available:0,reserved:0,held:0,blocked:0});assert.equal(closed.openingReview,false);
      }
      assert.equal((await tx.fgShipment.findUniqueOrThrow({where:{id:String(draft.id)}})).status,'CANCELLED');
      assert.deepEqual(await tx.fgShipment.findMany({where:{status:'SHIPPED'},orderBy:{id:'asc'}}),existingShipments);
      assert.equal(await tx.shipmentEvent.count(),existingEvents);
      const ledgerCount=await tx.fgLedger.count({where:{kind:'LEGACY_CLOSE'}});assert.equal(ledgerCount,before.length);
      const oldMovement=await tx.processQuantityMovement.findUniqueOrThrow({where:{id:source.movementId}});
      await tx.processQuantityMovement.update({where:{id:oldMovement.id},data:{quantity:oldMovement.quantity+1}});
      assert.equal((await tx.fgLot.findUniqueOrThrow({where:{id:source.id}})).pending,0);
      const newMovement=await tx.processQuantityMovement.create({data:{completionId:oldMovement.completionId,workOrderId:oldMovement.workOrderId,sourceStepId:oldMovement.sourceStepId,type:'FINISHED_GOOD',quantity:7,sourceSequenceGroup:1,idempotencyKey:randomUUID(),createdAt:new Date(Math.max(Date.now(),cutoff.startedAt.getTime()+1))}});
      let next=await tx.fgLot.findUniqueOrThrow({where:{movementId:newMovement.id}});assert.equal(next.pending,7);assert.equal(next.legacyClosedAt,null);
      await tx.$executeRawUnsafe('SELECT fg_initialize_cutover()');
      assert.equal((await tx.fgCutover.findUniqueOrThrow({where:{id:cutoff.id}})).startedAt.toISOString(),cutoff.startedAt.toISOString());
      assert.equal(await tx.fgLedger.count({where:{kind:'LEGACY_CLOSE'}}),ledgerCount);
      next=await tx.fgLot.findUniqueOrThrow({where:{id:next.id}});assert.equal(next.pending,7);assert.equal(next.legacyClosedAt,null);
      throw rollback;
    },{timeout:30000}),error=>error===rollback);
    current=await prisma.fgLot.findUniqueOrThrow({where:{id:source.id}});
    assert.equal(current.legacyClosedAt,null);assert.equal(current.reserved,4);
  });
});
