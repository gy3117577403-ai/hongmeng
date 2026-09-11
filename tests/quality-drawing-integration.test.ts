import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prisma} from '../lib/prisma';
import {saveQuick,quickCommand,quickWarningsForOrders,quickDrawingOptions,quickDetail} from '../lib/quality-quick';
import {createWorkOrderTravelerPrints,loadWorkOrderTravelerPrints} from '../lib/work-order-qr-service';

const skip=process.env.RUN_DB_INTEGRATION!=='1';
test('drawing warning without orders propagates to future orders, shares major print pipeline and preserves history',{skip},async()=>{
  const prefix='QD-'+randomUUID(),user=await prisma.user.create({data:{username:prefix,passwordHash:'integration-only',displayName:prefix,laborRole:'ADMIN'}});
  const product=await prisma.drawingLibraryItem.create({data:{customerName:prefix,productName:'接线束',specification:'DRAWING-V1',libraryKey:prefix}});
  const actor={id:user.id,name:prefix,admin:true,manage:true},orders:string[]=[];let recordId='',riskId='';
  async function order(suffix:string,linked=true){const o=await prisma.workOrder.create({data:{code:prefix+suffix,stage:'frontend',productName:'接线束',drawingLibraryItemId:linked?product.id:null,status:'processing',productionTargetQty:24,uncompletedQty:'24',completedQty:'0',processRoute:{create:{templateName:prefix,templateVersion:1,status:'in_progress',version:1,confirmedAt:new Date(),confirmedById:user.id,startedAt:new Date(),routeSource:'process_template',steps:{create:{processCode:'ASSEMBLY',processName:'装配',stageGroup:'frontend',position:1,sequenceGroup:1,standardSource:'integration_test',timeBasis:'per_unit',unitLabel:'套',standardMillisecondsPerUnit:3000,setupMilliseconds:0,unitsPerProduct:1,countsForEfficiency:true,inputQty:24,status:'current',startedAt:new Date()}}}}}});orders.push(o.id);return o;}
  try{
    const existing=await order('-existing');
    const input={productId:product.id,description:'普通异常：卡扣朝外',occurredAt:'2026-09-11',publish:true,mutationKey:randomUUID()};
    let r=(await saveQuick(actor,input,[])).record;recordId=r.id;
    assert.equal(r.orders.length,0);assert.equal(r.scope,'PRODUCT');assert.equal(r.printPolicy,'REQUIRED');
    assert.equal((await quickDrawingOptions(prefix))[0].id,product.id);
    assert.equal((await quickWarningsForOrders([existing.id])).get(existing.id)?.length,1);
    const future=await order('-future'),unlinked=await order('-unlinked',false);
    assert.equal((await quickWarningsForOrders([future.id])).get(future.id)?.length,1);
    await assert.rejects(saveQuick(actor,{...input,productId:'invalid',mutationKey:randomUUID()},[]),/图纸/);
    await assert.rejects(saveQuick(actor,{...input,orderIds:[unlinked.id],mutationKey:randomUUID()},[]),/不一致/);
    await prisma.drawingLibraryItem.update({where:{id:product.id},data:{remark:'补充资料',specification:'DRAWING-V2'}});
    assert.equal((await quickDetail(r.id)).scopeChanged,false);
    r=(await saveQuick(actor,{...input,id:r.id,version:r.version,orderIds:[existing.id],mutationKey:randomUUID()},[])).record;
    await prisma.workOrder.update({where:{id:existing.id},data:{deletedAt:new Date()}});
    r=(await saveQuick(actor,{...input,id:r.id,version:r.version,orderIds:[existing.id],mutationKey:randomUUID()},[])).record;
    assert.equal(r.orders[0].id,existing.id,'Historical source order does not block drawing warning edits');
    const risk=await prisma.internalQualityRiskReport.create({data:{reportNo:prefix,title:'A级来源',status:'ARCHIVED',severity:'LOW',warningState:'ACTIVE',printPolicy:'REQUIRED',archivedAt:new Date()}});riskId=risk.id;
    const revision=await prisma.internalQualityRiskRevision.create({data:{reportId:risk.id,revisionNumber:1,published:true,archivedAt:new Date(),snapshot:{title:'A级来源',severity:'LOW',warningSummary:'保持原内部等级',printPolicy:'REQUIRED'},products:{create:{drawingLibraryItemId:product.id}}}});
    await prisma.internalQualityRiskReport.update({where:{id:risk.id},data:{currentRevisionId:revision.id}});
    const packet=await createWorkOrderTravelerPrints({workOrderIds:[future.id,unlinked.id],userId:user.id,actor:prefix});
    assert.equal(packet.length,2);assert.deepEqual(packet[0].items.map(i=>i.material),['TRAVELER','QUALITY_WARNING']);assert.deepEqual(packet[1].items.map(i=>i.material),['TRAVELER']);
    const warnings=packet[0].snapshot.qualityWarnings;assert.equal(warnings.length,2);assert.equal(warnings[0].reportId,risk.id);assert.equal(warnings[1].reportId,r.id);
    assert.equal((await prisma.internalQualityRiskReport.findUniqueOrThrow({where:{id:risk.id}})).severity,'LOW');
    r=await quickCommand(actor,r.id,{action:'OFFLINE',version:r.version,mutationKey:randomUUID(),reason:'已处理'});
    const latest=await createWorkOrderTravelerPrints({workOrderIds:[future.id],userId:user.id,actor:prefix});assert.equal(latest[0].snapshot.qualityWarnings.length,1);
    assert.equal((await loadWorkOrderTravelerPrints([packet[0].printId]))[0].snapshot.qualityWarnings.length,2);
    await prisma.workOrder.update({where:{id:future.id},data:{drawingLibraryItemId:null}});
    assert.equal((await quickWarningsForOrders([future.id])).size,0);
  }finally{
    if(recordId){await prisma.quickQualityActivity.deleteMany({where:{recordId}});await prisma.quickQualityWorkOrder.deleteMany({where:{recordId}});await prisma.quickQualityRecord.delete({where:{id:recordId}});}
    if(riskId){await prisma.qualityWarningEmployeeLink.deleteMany({where:{revision:{reportId:riskId}}});await prisma.internalQualityRiskReport.update({where:{id:riskId},data:{currentRevisionId:null}});await prisma.internalQualityRiskReport.delete({where:{id:riskId}});}
    await prisma.workOrder.deleteMany({where:{id:{in:orders}}});await prisma.drawingLibraryItem.delete({where:{id:product.id}});await prisma.user.delete({where:{id:user.id}});
  }
});

test('legacy migration uniquely maps drawings, retains states and print policies, leaves ambiguous links untouched',{skip},async()=>{
  class Rollback extends Error{}
  await assert.rejects(prisma.$transaction(async tx=>{
    const prefix='MIG-'+randomUUID();
    const a=await tx.drawingLibraryItem.create({data:{customerName:prefix,specification:'A',libraryKey:prefix+'A'}}),b=await tx.drawingLibraryItem.create({data:{customerName:prefix,specification:'B',libraryKey:prefix+'B'}});
    const makeOrder=(suffix:string,id:string|null)=>tx.workOrder.create({data:{code:prefix+suffix,stage:'frontend',productName:'旧记录',drawingLibraryItemId:id}});
    const [one,two,missing]=await Promise.all([makeOrder('1',a.id),makeOrder('2',b.id),makeOrder('3',null)]);
    const make=(suffix:string,ids:string[],state='ACTIVE',deleted=false)=>tx.quickQualityRecord.create({data:{number:prefix+suffix,requestKey:prefix+suffix,description:'迁移图片与状态',scope:'WORK_ORDER',printPolicy:'SYSTEM_ONLY',state,deletedAt:deleted?new Date():null,createdById:'integration',createdByName:'旧品质',occurredAt:new Date(),orders:{create:ids.map(workOrderId=>({workOrderId}))}}});
    const good=await make('good',[one.id]),off=await make('off',[one.id],'OFFLINE'),deleted=await make('deleted',[one.id],'OFFLINE',true),ambiguous=await make('ambiguous',[one.id,two.id]),partial=await make('partial',[one.id,missing.id]);
    const sql=readFileSync('prisma/migrations/20260911090000_quality_drawing_link/migration.sql','utf8');await tx.$executeRawUnsafe(sql.slice(sql.indexOf('WITH candidates')));
    for(const old of [good,off,deleted]){const r=await tx.quickQualityRecord.findUniqueOrThrow({where:{id:old.id}});assert.equal(r.productId,a.id);assert.equal(r.state,old.state);assert.equal(r.printPolicy,old.printPolicy);assert.deepEqual(r.deletedAt,old.deletedAt);assert.equal(r.version,2);assert.equal(await tx.quickQualityActivity.count({where:{recordId:r.id,action:'DRAWING_LINK_MIGRATED'}}),1);}
    for(const old of [ambiguous,partial]){const r=await tx.quickQualityRecord.findUniqueOrThrow({where:{id:old.id}});assert.equal(r.productId,null);assert.equal(r.scope,'WORK_ORDER');assert.equal(r.version,1);}
    await tx.$executeRawUnsafe(sql.slice(sql.indexOf('WITH candidates')));assert.equal(await tx.quickQualityActivity.count({where:{recordId:good.id}}),1);
    throw new Rollback();
  },{timeout:30000}),e=>e instanceof Rollback);
});
