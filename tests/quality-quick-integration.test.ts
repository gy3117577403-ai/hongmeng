import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { saveQuick,quickCommand,quickWarningsForOrders,quickWarningsForProduct,quickList,quickSummary,handoffQuickWarnings,quickDetail,quickDate } from '../lib/quality-quick';
test('quick quality lifecycle, concurrency, product scope, revisions and escalation use independent records',{skip:process.env.RUN_DB_INTEGRATION!=='1'},async t=>{
  const key='qq-it-'+randomUUID(),user=await prisma.user.create({data:{username:key,passwordHash:'integration-only',displayName:'快处集成品质'}});
  const actor={id:user.id,name:user.displayName,admin:false,manage:true};
  const product=await prisma.drawingLibraryItem.create({data:{customerName:key,productName:'连接线束',specification:'V1',libraryKey:key}});
  const orders=await Promise.all([1,2,3].map(n=>prisma.workOrder.create({data:{code:key+'-'+n,stage:'frontend',productName:'连接线束',customerName:key,drawingLibraryItemId:n===3?null:product.id}})));
  const input={description:'端子装反，现场已纠正',orderIds:[orders[0].id],occurredAt:'2026-09-10',mutationKey:randomUUID(),scope:'WORK_ORDER',publish:false};
  const ids:string[]=[];let r:Awaited<ReturnType<typeof saveQuick>>['record'];
  try {
    await t.test('save-only, create retry and changed-payload conflict',async()=>{
      const [a,b]=await Promise.all([saveQuick(actor,input,[]),saveQuick(actor,input,[])]);
      r=a.record;ids.push(r.id);assert.equal(r.id,b.record.id);
      assert.equal((await quickWarningsForOrders([orders[0].id])).size,0);
      await assert.rejects(saveQuick(actor,{...input,description:'different'},[]),/发生变化/);
      await assert.rejects(saveQuick({...actor,manage:false},input,[]),/权限/);
      await assert.rejects(saveQuick(actor,{...input,mutationKey:randomUUID(),keepPhotoIds:['foreign']},[]),/图片不属于/);
    });
    await t.test('drawing publication covers existing orders, concurrent edits reject stale version',async()=>{
      const update={...input,id:r.id,version:r.version,mutationKey:randomUUID(),publish:true};
      const updates=await Promise.allSettled([saveQuick(actor,update,[]),saveQuick(actor,{...update,mutationKey:randomUUID()},[])]);
      assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);
      r=(updates.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof saveQuick>>>).value.record;
      const warnings=await quickWarningsForOrders(orders.map(o=>o.id));assert.equal(warnings.get(orders[0].id)?.length,1);assert.equal(warnings.get(orders[1].id)?.length,1);
      assert.equal((await quickWarningsForProduct(product.id)).length,1);
    });
    await t.test('delete atomically unpublishes, admin restore stays offline with trace',async()=>{
      const command={action:'DELETE',reason:'重复录入',version:r.version,mutationKey:randomUUID()};
      r=await quickCommand(actor,r.id,command);
      assert.ok(r.deletedAt);assert.equal(r.state,'OFFLINE');assert.equal((await quickWarningsForOrders([orders[0].id])).size,0);
      assert.equal((await quickCommand(actor,r.id,command)).version,r.version);
      await assert.rejects(quickCommand(actor,r.id,{action:'RESTORE',version:r.version,mutationKey:randomUUID()}),/管理员/);
      r=await quickCommand({...actor,admin:true},r.id,{action:'RESTORE',version:r.version,mutationKey:randomUUID()});
      assert.equal(r.state,'OFFLINE');assert.equal((await quickDetail(r.id,true)).activities?.length,4);
    });
    await t.test('drawing publication includes future orders and survives metadata edits',async()=>{
      r=(await saveQuick(actor,{...input,id:r.id,version:r.version,mutationKey:randomUUID(),scope:'PRODUCT',publish:true},[])).record;
      assert.equal((await quickWarningsForOrders([orders[1].id])).get(orders[1].id)?.length,1);
      const future=await prisma.workOrder.create({data:{code:key+'-future',stage:'frontend',productName:'后续订单',drawingLibraryItemId:product.id}});orders.push(future);
      assert.equal((await quickWarningsForOrders([future.id])).get(future.id)?.length,1);
      await prisma.drawingLibraryItem.update({where:{id:product.id},data:{specification:'V2'}});
      assert.equal((await quickWarningsForOrders([future.id])).get(future.id)?.length,1);assert.equal((await quickWarningsForProduct(product.id)).length,1);
      assert.equal((await quickDetail(r.id)).scopeChanged,false);
      r=(await saveQuick(actor,{...input,id:r.id,version:r.version,mutationKey:randomUUID(),scope:'PRODUCT',publish:true},[])).record;
      assert.equal((await quickWarningsForOrders([future.id])).get(future.id)?.length,1);
      await assert.rejects(saveQuick(actor,{...input,mutationKey:randomUUID(),orderIds:[orders[2].id],scope:'PRODUCT'},[]),/同一份有效/);
    });
    await t.test('filter totals agree and invalid calendar dates reject',async()=>{
      const list=await quickList(new URLSearchParams({q:orders[0].code,state:'ACTIVE',from:'2026-09-10',to:'2026-09-10'}));assert.equal(list.total,1);
      assert.throws(()=>quickDate('2026-02-31','日期'),/无效/);
      assert.ok((await quickSummary()).active>=1);
    });
    await t.test('escalation carries sources and published formal warning hands off once',async()=>{
      r=await quickCommand(actor,r.id,{action:'ESCALATE',version:r.version,mutationKey:randomUUID()});assert.ok(r.escalatedReportId);
      const risk=await prisma.internalQualityRiskReport.findUniqueOrThrow({where:{id:r.escalatedReportId!},include:{workOrders:true,products:true}});
      assert.equal(risk.defectPhenomenon,input.description);assert.equal(risk.status,'DRAFT');assert.equal(risk.workOrders.length,1);
      assert.equal((await quickWarningsForOrders([orders[0].id])).get(orders[0].id)?.length,1);
      await prisma.$transaction(tx=>handoffQuickWarnings(tx,r.escalatedReportId!,actor));
      assert.equal((await quickWarningsForOrders([orders[0].id])).size,0);
      const after=await quickDetail(r.id,true);assert.equal(after.state,'OFFLINE');const version=after.version;
      await prisma.$transaction(tx=>handoffQuickWarnings(tx,r.escalatedReportId!,actor));
      assert.equal((await quickDetail(r.id)).version,version);
    });
  } finally {
    const records=await prisma.quickQualityRecord.findMany({where:{createdById:user.id}});
    await prisma.quickQualityActivity.deleteMany({where:{recordId:{in:records.map(r=>r.id)}}});
    await prisma.quickQualityWorkOrder.deleteMany({where:{recordId:{in:records.map(r=>r.id)}}});
    await prisma.quickQualityRecord.deleteMany({where:{createdById:user.id}});
    await prisma.internalQualityRiskReport.deleteMany({where:{createdById:user.id}});
    await prisma.workOrder.deleteMany({where:{id:{in:orders.map(o=>o.id)}}});
    await prisma.drawingLibraryItem.delete({where:{id:product.id}});
    await prisma.user.delete({where:{id:user.id}});
  }
});
