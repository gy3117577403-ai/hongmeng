import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '../lib/prisma';
import {completeSampleRepeat,ensureSampleWarehouse} from '../lib/sample-plan-operations';
import {correctSamplePlan} from '../lib/sample-plan-correction';
import {listSamplePlans} from '../lib/sample-plan-query';

test('sample plan scopes, real quantities, corrections and import lineage stay consistent', {skip:process.env.RUN_DB_INTEGRATION!=='1'},async t=>{
 const tag='SAMPLE-REALIGN-'+randomUUID().slice(0,8);
 const user=await prisma.user.create({data:{username:tag,displayName:'样品计划验收',passwordHash:'no-login',laborRole:'ADMIN'}});
 const actor={id:user.id,name:user.displayName};
 const item=await prisma.drawingLibraryItem.create({data:{libraryKey:tag,customerName:tag,productName:'样品线束',specification:tag}});
 const task=await prisma.sampleTask.create({data:{code:tag,qrCode:tag,drawingLibraryItemId:item.id,customerNameSnapshot:tag,specificationSnapshot:tag,taskType:'NEW',sampleQuantity:24,unitPlannedMilliseconds:750000,planWeekStartDate:new Date('2026-09-21'),createdById:user.id,createdByName:actor.name}});
 const legacy=await prisma.sampleTask.create({data:{code:tag+'-OLD',qrCode:tag+'-OLD',drawingLibraryItemId:item.id,customerNameSnapshot:tag,specificationSnapshot:tag,status:'COMPLETED',sampleQuantity:5,completedQuantityKnown:false,createdById:user.id,createdByName:actor.name}});
 const cancelled=await prisma.sampleTask.create({data:{code:tag+'-CANCEL',qrCode:tag+'-CANCEL',drawingLibraryItemId:item.id,customerNameSnapshot:tag,specificationSnapshot:tag,status:'CANCELLED',sampleQuantity:8,createdById:user.id,createdByName:actor.name}});
 const ids=[task.id,legacy.id,cancelled.id];
 const fresh=()=>prisma.sampleTask.findUniqueOrThrow({where:{id:task.id}});
 const list=(values:Record<string,string>={})=>listSamplePlans(new URLSearchParams({keyword:tag,view:'ALL',summary:'true',...values}));
 const correction=(id:string,input:Record<string,unknown>)=>prisma.$transaction(tx=>correctSamplePlan(tx,id,input,actor),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 try {
  await t.test('formal scope excludes cancelled and keeps unknown completed history separate from unplanned',async()=>{
   const result=await list();assert.equal(result.pagination.total,2);assert.equal(result.summary.quantity,29);assert.equal(result.summary.unknownCompletedCount,1);assert.equal(result.summary.totalPlannedMilliseconds,'18000000');
   assert.equal((await list({week:'unplanned'})).pagination.total,0);assert.equal((await list({view:'COMPLETED'})).pagination.total,1);assert.equal((await list({week:'2026-09-21',view:'COMPLETED'})).pagination.total,0);
  });
  await t.test('historical quantity correction records evidence without manufacturing stock',async()=>{
   const body={action:'CORRECT_COMPLETION',expectedVersion:legacy.version,mutationId:randomUUID(),quantity:4,reason:'核对历史纸质记录'};
   await correction(legacy.id,body);await correction(legacy.id,body);
   assert.equal((await prisma.sampleTask.findUniqueOrThrow({where:{id:legacy.id}})).completedQuantity,4);
   assert.equal(await prisma.fgLot.count({where:{sampleTaskId:legacy.id}}),0);
   assert.equal(await prisma.sampleCompletion.count({where:{taskId:legacy.id}}),0);
   await assert.rejects(()=>correction(legacy.id,{...body,quantity:3}),/内容已变化/);
  });
  await t.test('new product partial completion requires actual date and only transfers confirmed quantity',async()=>{
   const base={expectedVersion:(await fresh()).version,mutationId:randomUUID(),quantity:8,confirmNoData:true};
   await assert.rejects(()=>prisma.$transaction(tx=>completeSampleRepeat(tx,task.id,base,actor)),/现场完成日期/);
   const input={...base,workDate:'2026-09-21'};
   await prisma.$transaction(tx=>completeSampleRepeat(tx,task.id,input,actor));await prisma.$transaction(tx=>completeSampleRepeat(tx,task.id,input,actor));
   const current=await fresh();assert.equal(current.completedQuantity,8);assert.equal(current.status,'IN_PROGRESS');
   const lot=await prisma.fgLot.findFirstOrThrow({where:{sampleTaskId:task.id}});assert.equal(lot.pending,8);assert.equal(lot.productionWorkDate?.toISOString().slice(0,10),'2026-09-21');
   assert.equal((await list({week:'2026-09-21'})).summary.remainingPlannedMilliseconds,'12000000');
  });
  await t.test('correcting actual quantity adjusts warehouse atomically and stale writes fail',async()=>{
   const completion=await prisma.sampleCompletion.findFirstOrThrow({where:{taskId:task.id}});
   const body={action:'CORRECT_COMPLETION',expectedVersion:(await fresh()).version,mutationId:randomUUID(),completionId:completion.id,quantity:6,workDate:'2026-09-20',reason:'原登记多录两套'};
   await correction(task.id,body);await correction(task.id,body);
   const lot=await prisma.fgLot.findFirstOrThrow({where:{sampleTaskId:task.id}});assert.equal(lot.pending,6);assert.equal(lot.sourceQuantity,6);assert.equal((await fresh()).completedQuantity,6);
   assert.equal(await prisma.fgLedger.count({where:{lotId:lot.id,kind:'SAMPLE_CORRECTION'}}),1);
   await assert.rejects(()=>correction(task.id,{...body,mutationId:randomUUID(),quantity:5}),/已被修改/);
   await prisma.fgLot.update({where:{id:lot.id},data:{pending:0,available:4,reserved:2}});
   await assert.rejects(async()=>correction(task.id,{...body,expectedVersion:(await fresh()).version,mutationId:randomUUID(),quantity:5}),/发货、占用/);
   assert.equal((await fresh()).completedQuantity,6);
   await prisma.fgLot.update({where:{id:lot.id},data:{pending:6,available:0,reserved:0}});
  });
  await t.test('quantity and time edits re-confirm material readiness and recalculate all scoped totals',async()=>{
   const warehouse=await prisma.$transaction(tx=>ensureSampleWarehouse(tx,task));
   await prisma.warehouseMaterialTask.update({where:{id:warehouse!.id},data:{status:'completed',requirementsConfirmed:true,completedAt:new Date()}});
   await correction(task.id,{action:'CORRECT_METADATA',expectedVersion:(await fresh()).version,mutationId:randomUUID(),sampleQuantity:30,unitPlannedMinutes:'15',reason:'客户加单'});
   const current=await prisma.warehouseMaterialTask.findUniqueOrThrow({where:{id:warehouse!.id}});assert.equal(current.status,'pending');assert.equal(current.requirementsConfirmed,false);
   const result=await list({week:'2026-09-21'});assert.equal(result.summary.totalPlannedMilliseconds,'27000000');assert.equal(result.summary.remainingPlannedMilliseconds,'21600000');
  });
  await t.test('a later update does not erase membership of an earlier import batch',async()=>{
   for(const suffix of ['A','B'])await prisma.sampleTaskImportBatch.create({data:{mutationId:tag+suffix,requestHash:suffix,result:{rows:[{taskId:task.id,status:suffix==='A'?'CREATED':'UPDATED'}]}}});
   await prisma.sampleTask.update({where:{id:task.id},data:{importMutationId:tag+'B'}});
   assert.equal((await list({importBatch:tag+'A'})).pagination.total,1);assert.equal((await list({importBatch:tag+'B'})).pagination.total,1);
  });
 } finally {
  await prisma.sampleTaskImportBatch.deleteMany({where:{mutationId:{in:[tag+'A',tag+'B']}}});
  await prisma.fgLedger.deleteMany({where:{lot:{sampleTaskId:{in:ids}}}});await prisma.fgLot.deleteMany({where:{sampleTaskId:{in:ids}}});await prisma.sampleCompletion.deleteMany({where:{taskId:{in:ids}}});
  await prisma.warehouseMaterialActivity.deleteMany({where:{task:{sampleTaskId:{in:ids}}}});await prisma.warehouseMaterialTask.deleteMany({where:{sampleTaskId:{in:ids}}});
  await prisma.operationLog.deleteMany({where:{userId:user.id}});await prisma.sampleTask.deleteMany({where:{id:{in:ids}}});await prisma.drawingLibraryItem.delete({where:{id:item.id}});await prisma.user.delete({where:{id:user.id}});
 }
});
