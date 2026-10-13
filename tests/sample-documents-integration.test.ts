import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { currentSampleDocuments, saveSampleDocument, isSampleDocumentReferenced, type SampleDocumentUpload } from '../lib/sample-documents';
import { completeSampleRepeat, ensureSampleWarehouse } from '../lib/sample-plan-operations';
import { previewSampleTaskDeletion, softDeleteSampleTask, restoreSampleTask } from '../lib/sample-task-deletion';
import { listSamplePlans } from '../lib/sample-plan-query';
import { retireReplacedDrawing } from '../lib/drawing-replacement';

test('sample document changes preserve order identity, shared evidence and recoverable history',{skip:process.env.RUN_DB_INTEGRATION!=='1'},async t=>{
 const tag='SDOC-'+randomUUID().slice(0,8);
 const user=await prisma.user.create({data:{username:tag,passwordHash:'fixture-only',displayName:'图纸验收',laborRole:'ADMIN'}});
 const actor={id:user.id,name:user.displayName};
 const category=await prisma.resourceCategory.upsert({where:{code:'drawing'},update:{},create:{code:'drawing',name:'图纸',sortOrder:0}});
 const item=await prisma.drawingLibraryItem.create({data:{libraryKey:tag,specification:tag,customerName:tag}});
 const original=await prisma.drawingLibraryFile.create({data:{libraryItemId:item.id,categoryId:category.id,originalName:'original.pdf',mimeType:'application/pdf',size:10,objectKey:tag+'/old',version:'V1.0',uploadedById:user.id}});
 const second=await prisma.drawingLibraryFile.create({data:{libraryItemId:item.id,categoryId:category.id,originalName:'page2.pdf',mimeType:'application/pdf',size:10,objectKey:tag+'/page2',version:'V1.1',uploadedById:user.id}});
 const create=async(code:string)=>{const task=await prisma.sampleTask.create({data:{code:tag+code,qrCode:tag+code,drawingLibraryItemId:item.id,customerNameSnapshot:tag,specificationSnapshot:tag,taskType:'REPEAT',sampleQuantity:3}});await prisma.$transaction(tx=>ensureSampleWarehouse(tx,task));return task;};
 const a=await create('-A'),b=await create('-B'),started=await create('-STARTED');
 const siblingWarehouseVersion=(await prisma.warehouseMaterialTask.findUniqueOrThrow({where:{sampleTaskId:b.id}})).version;
 const get=(id=a.id)=>prisma.sampleTask.findUniqueOrThrow({where:{id}});
 const files=async(id=a.id)=>currentSampleDocuments(prisma,await get(id));
 const input:SampleDocumentUpload={taskId:a.id,expectedVersion:a.version,mutationId:randomUUID(),replaceFileId:original.id,kind:'drawing',reason:'修正线长',materialChanged:false,name:'corrected.pdf',mimeType:'application/pdf',size:12,objectKey:tag+'/new',sha256:'new-hash',actor};
 let newId='';
 try {
  await t.test('replacement affects exactly one file on one order and replay is idempotent',async()=>{
   const saved=await prisma.$transaction(tx=>saveSampleDocument(tx,input));newId=saved.fileId;
   assert.equal((await prisma.$transaction(tx=>saveSampleDocument(tx,input))).replayed,true);
   assert.equal(await prisma.drawingLibraryFile.count({where:{sourceEntityId:a.id}}),1);
   assert.deepEqual((await files()).map(f=>f.id),[newId,second.id]);
   assert.deepEqual((await files(b.id)).map(f=>f.id),[original.id,second.id]);
   assert.equal((await get()).qrCode,a.qrCode);assert.equal((await get()).code,a.code);
   assert.equal((await prisma.drawingLibraryFile.findUniqueOrThrow({where:{id:original.id}})).isCurrent,true);
   assert.equal((await prisma.drawingLibraryFile.findUniqueOrThrow({where:{id:newId}})).isCurrent,false);
   await assert.rejects(()=>prisma.$transaction(tx=>saveSampleDocument(tx,{...input,reason:'changed replay'})),/内容已变化/);
   await assert.rejects(()=>prisma.$transaction(tx=>saveSampleDocument(tx,{...input,mutationId:randomUUID()})),/订单已更新/);
  });
  await t.test('physical completion freezes actual document version; replacement keeps finished stock',async()=>{
   const current=await get();await prisma.$transaction(tx=>completeSampleRepeat(tx,a.id,{expectedVersion:current.version,mutationId:randomUUID(),quantity:3,workDate:'2026-10-14'},actor));
   const completed=await get();const result=await prisma.$transaction(tx=>saveSampleDocument(tx,{...input,expectedVersion:completed.version,mutationId:randomUUID(),replaceFileId:newId,sha256:'final',objectKey:tag+'/correction',reason:'归档资料更正'}));
   assert.notEqual(result.fileId,newId);const completion=await prisma.sampleCompletion.findFirstOrThrow({where:{taskId:a.id}});
   assert.equal((completion.documentSnapshot as any[])[0].id,newId);
   assert.equal((await get()).completedQuantity,3);assert.equal(await prisma.fgLot.count({where:{sampleTaskId:a.id}}),1);
   const latest=await get();await assert.rejects(()=>prisma.$transaction(tx=>saveSampleDocument(tx,{...input,expectedVersion:latest.version,mutationId:randomUUID(),materialChanged:true})),/不重新配料/);
  });
  await t.test('material changes reopen only this warehouse task and in-progress change requires acknowledgement',async()=>{
   await prisma.sampleTask.update({where:{id:started.id},data:{status:'IN_PROGRESS'}});
   await prisma.warehouseMaterialTask.update({where:{sampleTaskId:started.id},data:{status:'completed',requirementsConfirmed:true,completedAt:new Date()}});
   const req={...input,taskId:started.id,expectedVersion:started.version,mutationId:randomUUID(),materialChanged:true};
   await assert.rejects(()=>prisma.$transaction(tx=>saveSampleDocument(tx,req)),/通知现场/);
   await prisma.$transaction(tx=>saveSampleDocument(tx,{...req,productionAcknowledged:true}));
   assert.equal((await prisma.warehouseMaterialTask.findUniqueOrThrow({where:{sampleTaskId:started.id}})).status,'pending');
   assert.equal((await prisma.warehouseMaterialTask.findUniqueOrThrow({where:{sampleTaskId:b.id}})).version,siblingWarehouseVersion);
  });
  await t.test('archive replacement cannot purge a drawing referenced by a sample or completion',async()=>{
   assert.equal(await isSampleDocumentReferenced(prisma,original.id),true);
   const next=await prisma.drawingLibraryFile.create({data:{libraryItemId:item.id,categoryId:category.id,originalName:'mass-change.pdf',mimeType:'application/pdf',size:10,objectKey:tag+'/mass',version:'V1.99',uploadedById:user.id}});
   await prisma.$transaction(tx=>retireReplacedDrawing(tx,original,next,user,'共享库更换'));
   assert.equal((await prisma.drawingReplacementJob.findFirstOrThrow({where:{sourceFileId:original.id}})).purgePending,false);
   assert.equal((await files(b.id))[0].id,original.id);
  });
  await t.test('in-progress soft delete needs stop confirmation and restores to planned with all evidence',async()=>{
   const preview=await previewSampleTaskDeletion(started.id);
   const request={id:started.id,actorId:user.id,actorName:user.displayName,reason:'客户暂缓',confirmationCode:started.code,previewToken:preview.previewToken,expectedVersion:preview.task.version,confirmed:true,clientMutationId:randomUUID()};
   assert.equal(preview.canDelete,true);assert.equal(preview.requiresStopConfirmation,true);
   await assert.rejects(()=>softDeleteSampleTask(request),/停止制作/);
   await softDeleteSampleTask({...request,stopConfirmed:true});
   assert.equal((await listSamplePlans(new URLSearchParams({keyword:started.code,view:'ALL',warehouse:'true'}))).pagination.total,0);
   const deleted=await get(started.id);assert.ok(deleted.deletedAt);assert.ok(await isSampleDocumentReferenced(prisma,original.id));
   const restored=await restoreSampleTask({id:started.id,actorId:user.id,actorName:user.displayName,reason:'重新安排',confirmationCode:started.code,expectedVersion:deleted.version,confirmed:true});
   assert.equal(restored.status,'PLANNED');assert.equal(restored.qrCode,started.qrCode);
   assert.equal((await files(started.id)).length,2);
  });
  await t.test('planned order deletion and restore leave completed quantities and references untouched',async()=>{
   for(const task of [await get(b.id),await get(a.id)]){
    const preview=await previewSampleTaskDeletion(task.id);assert.equal(preview.canDelete,true);
    const args={id:task.id,actorId:user.id,actorName:user.displayName,reason:'误建订单',confirmationCode:task.code,previewToken:preview.previewToken,expectedVersion:task.version,confirmed:true,clientMutationId:randomUUID()};
    await softDeleteSampleTask(args);assert.equal((await softDeleteSampleTask(args)).replayed,true);
    const deleted=await get(task.id);
    const restored=await restoreSampleTask({...args,reason:'恢复验收',expectedVersion:deleted.version});
    assert.equal(restored.status,task.status);assert.equal(restored.completedQuantity,task.completedQuantity);
   }
  });
 } finally {
  await prisma.sampleTask.updateMany({where:{id:{in:[a.id,b.id,started.id]}},data:{deletedAt:new Date()}});
  await prisma.drawingLibraryItem.update({where:{id:item.id},data:{deletedAt:new Date()}});
  await prisma.drawingReplacementJob.updateMany({where:{libraryItemId:item.id},data:{syncPending:false,purgePending:false}});
 }
});
