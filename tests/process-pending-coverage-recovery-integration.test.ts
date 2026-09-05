import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { deployPublishedProductTimeRoutesInTransaction } from '../lib/product-time-deployment-service';
import { recoverStalePendingCompletionCoverage } from '../lib/process-pending-coverage-recovery';

const run = process.env.RUN_DB_INTEGRATION === '1';
async function recover(routeId: string) {
  const origin = process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN;
  if (!origin) return recoverStalePendingCompletionCoverage({routeId});
  const url = new URL('/api/internal/process-route-change-outbox', origin);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  const response = await fetch(url,{method:'POST',headers:{'x-outbox-worker-token':process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN||''}});
  assert.equal(response.status,200);
  const body = await response.json() as {coverageRecovery: Awaited<ReturnType<typeof recoverStalePendingCompletionCoverage>>};
  assert.ok(body.coverageRecovery);return body.coverageRecovery;
}

for (const mode of ['published-deployment','historical-recovery'] as const) {
  test(`${mode}: existing inspection and packing reports settle once after an upstream operation is removed`, {skip:!run}, async()=>{
    const prefix=`IT-PENDING-${Date.now()}-${randomUUID().slice(0,8)}`;
    const actor=await prisma.user.create({data:{username:prefix,passwordHash:'not-a-login-hash',displayName:prefix,laborRole:'ADMIN'}});
    const employee=await prisma.employee.create({data:{employeeNo:prefix,name:prefix,department:'生产部'}});
    const item=await prisma.drawingLibraryItem.create({data:{customerName:'integration-test',productName:'coverage recovery',specification:prefix,libraryKey:prefix}});
    const definitions=await Promise.all(['裁线','导通旧工序','检验','包装'].map((name,index)=>prisma.processDefinition.create({data:{code:`${prefix}-${index}`,name,stageGroup:index<2?'frontend':'backend',sortOrder:index+1}})));
    const profile=await prisma.productTimeProfile.create({data:{drawingLibraryItemId:item.id,version:1,status:'published',publishedAt:new Date(),createdById:actor.id,entries:{create:definitions.map((definition,index)=>({processDefinitionId:definition.id,occurrenceKey:`operation-${index}`,position:index+1,sequenceGroup:index+1,timeBasis:'per_unit',unitMilliseconds:1000,occurrences:1,unitLabel:'套'}))}},include:{entries:{orderBy:{position:'asc'}}}});
    const order=await prisma.workOrder.create({data:{code:prefix,customerName:item.customerName,productName:'coverage recovery',specification:prefix,drawingLibraryItemId:item.id,stage:'frontend',status:'processing',productionTargetQty:40,uncompletedQty:'40',completedQty:'0',planType:'managed_plan',planActive:true,startedAt:new Date(),processRoute:{create:{templateName:prefix,templateVersion:1,routeSource:'product_time_profile',productTimeProfileId:profile.id,productTimeProfileVersion:1,reportingPolicy:'free_sequence',status:'in_progress',confirmedAt:new Date(),confirmedById:actor.id,startedAt:new Date(),steps:{create:profile.entries.map((entry,index)=>({processDefinitionId:entry.processDefinitionId,processCode:definitions[index].code,processName:definitions[index].name,stageGroup:definitions[index].stageGroup,position:index+1,sequenceGroup:index+1,productTimeProfileId:profile.id,productTimeEntryId:entry.id,productTimeProfileVersion:1,standardSource:'product_profile',timeBasis:'per_unit',standardMillisecondsPerUnit:1000,unitLabel:'套',unitsPerProduct:1,countsForEfficiency:true,inputQty:index===0?40:0,status:index===0?'current':'pending'}))}}}},include:{processRoute:{include:{steps:{orderBy:{position:'asc'}}}}}});
    const route=order.processRoute!;
    const [cut,obsolete,inspect,pack]=route.steps;
    try {
      for(const step of [inspect,pack,cut]) {
        const current=await prisma.workOrderProcessRoute.findUniqueOrThrow({where:{id:route.id}});
        await completeProcessStep({routeId:route.id,stepId:step.id,processedQty:40,defectQty:0,workDate:'2026-09-03',employeeIds:[employee.id],requireParticipants:true,allowAdvanceReporting:true,idempotencyKey:`${prefix}-${step.id}`,expectedRouteVersion:current.version,userId:actor.id,actor:prefix});
      }
      const originalReports=await prisma.processCompletion.findMany({where:{routeId:route.id},orderBy:{id:'asc'},select:{id:true,completedAt:true,processedQty:true,workDate:true}});
      const originalLabor=await prisma.processLaborPool.findMany({where:{workOrderId:order.id},orderBy:{id:'asc'},include:{claims:true}});
      assert.equal(originalReports.length,3);assert.equal(originalLabor.length,3);
      assert.equal(await prisma.processCompletion.count({where:{routeId:route.id,coverageStatus:'PENDING'}}),2);
      assert.equal((await recover(route.id)).repairedRouteIds.includes(route.id),false,'no upstream input means no recovery');
      if(mode==='published-deployment') {
        await prisma.productTimeProfile.update({where:{id:profile.id},data:{status:'archived'}});
        const next=await prisma.productTimeProfile.create({data:{drawingLibraryItemId:item.id,version:2,status:'published',publishedAt:new Date(),createdById:actor.id,entries:{create:profile.entries.filter((_,index)=>index!==1).map((entry,index)=>({processDefinitionId:entry.processDefinitionId,occurrenceKey:entry.occurrenceKey,position:index+1,sequenceGroup:index+1,timeBasis:'per_unit',unitMilliseconds:1000,occurrences:1,unitLabel:'套'}))}}});
        const deploy=()=>prisma.$transaction(tx=>deployPublishedProductTimeRoutesInTransaction(tx,{itemId:item.id,profileId:next.id,actorId:actor.id,sourceChangeId:prefix}),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
        const result=await deploy();assert.equal(result.updated,1);
        await deploy(); // Same published deployment is idempotent.
      } else {
        // Reproduce the derived projection left by the previous application:
        // a removed upstream step hands its input to inspection, but no replay
        // runs. Reports and credited labor above came through the real service.
        await prisma.workOrderProcessStep.update({where:{id:obsolete.id},data:{retiredAt:new Date(),status:'skipped',inputQty:0}});
        await prisma.workOrderProcessStep.update({where:{id:inspect.id},data:{inputQty:40}});
        await prisma.workOrder.update({where:{id:order.id},data:{productionPausedAt:new Date()}});
        assert.equal((await recover(route.id)).repairedRouteIds.includes(route.id),false,'paused work remains paused');
        await prisma.workOrder.update({where:{id:order.id},data:{productionPausedAt:null}});
        await prisma.workOrderProcessStep.update({where:{id:inspect.id},data:{reportQuantityBasis:'action'}});
        assert.equal((await recover(route.id)).repairedRouteIds.includes(route.id),false,'action quantities require their own unit reconciliation');
        await prisma.workOrderProcessStep.update({where:{id:inspect.id},data:{reportQuantityBasis:'product'}});
        const result=await recover(route.id);assert.deepEqual(result.failures,[]);assert.ok(result.repairedRouteIds.includes(route.id));
      }
      const state=await prisma.workOrderProcessRoute.findUniqueOrThrow({where:{id:route.id},include:{workOrder:true,steps:{where:{retiredAt:null}}}});
      assert.equal(state.status,'completed');assert.equal(state.workOrder.stage,'completed');assert.equal(state.workOrder.completedQty,'40');
      assert.ok(state.steps.every(step=>step.status==='completed'||step.status==='skipped'));
      assert.equal(await prisma.processCompletion.count({where:{routeId:route.id,coverageStatus:{not:'COVERED'}}}),0);
      const finished=await prisma.processQuantityMovement.aggregate({where:{workOrderId:order.id,type:'FINISHED_GOOD'},_sum:{quantity:true}});
      assert.equal(finished._sum.quantity,40);
      const movements=await prisma.processQuantityMovement.count({where:{workOrderId:order.id}});
      assert.equal((await recover(route.id)).repairedRouteIds.includes(route.id),false);
      assert.equal(await prisma.processQuantityMovement.count({where:{workOrderId:order.id}}),movements);
      assert.deepEqual(await prisma.processCompletion.findMany({where:{routeId:route.id},orderBy:{id:'asc'},select:{id:true,completedAt:true,processedQty:true,workDate:true}}),originalReports);
      assert.deepEqual(await prisma.processLaborPool.findMany({where:{workOrderId:order.id},orderBy:{id:'asc'},include:{claims:true}}),originalLabor);
    } finally {
      await prisma.processLaborClaim.deleteMany({where:{pool:{workOrderId:order.id}}});
      await prisma.processLaborPool.deleteMany({where:{workOrderId:order.id}});
      await prisma.processExecution.deleteMany({where:{step:{routeId:route.id}}});
      await prisma.processQuantityMovement.deleteMany({where:{workOrderId:order.id}});
      await prisma.processCompletion.deleteMany({where:{routeId:route.id}});
      await prisma.productTimeDeploymentRoute.deleteMany({where:{routeId:route.id}});
      await prisma.workOrderProcessRoute.delete({where:{id:route.id}});
      await prisma.workOrder.delete({where:{id:order.id}});
      await prisma.productTimeDeployment.deleteMany({where:{drawingLibraryItemId:item.id}});
      await prisma.productTimeProfile.deleteMany({where:{drawingLibraryItemId:item.id}});
      await prisma.drawingLibraryItem.delete({where:{id:item.id}});
      await prisma.processDefinition.deleteMany({where:{id:{in:definitions.map(d=>d.id)}}});
      await prisma.employee.delete({where:{id:employee.id}});await prisma.user.delete({where:{id:actor.id}});
    }
  });
}
