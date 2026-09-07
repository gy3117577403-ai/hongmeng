const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
if (process.env.REPORT_RECOVERY_QA_ALLOW !== 'disposable-reporting-runtime') throw Error('Disposable reporting runtime required');
const db=new PrismaClient();
async function main() {
  const f=JSON.parse(readFileSync(process.env.REPORT_RECOVERY_QA_FIXTURE,'utf8').replace(/^\uFEFF/,''));
  const marker='QA-REPLACE-'+randomUUID().slice(0,8);
  const definitions=await Promise.all(['裁线','导通','包装','线序检验'].map((name,index)=>db.processDefinition.create({data:{code:marker+'-'+index,name,stageGroup:'backend'}})));
  const item=await db.drawingLibraryItem.create({data:{customerName:'工序替换验收',productName:'线束',specification:marker,libraryKey:marker}});
  const profile=await db.productTimeProfile.create({data:{drawingLibraryItemId:item.id,version:1,status:'published',publishedAt:new Date(),createdById:f.users.admin.id,
    entries:{create:definitions.slice(0,3).map((d,i)=>({processDefinitionId:d.id,occurrenceKey:'original-'+i,position:i+1,sequenceGroup:i+1,timeBasis:'per_unit',unitMilliseconds:1000,occurrences:1,unitLabel:'套'}))}},include:{entries:{orderBy:{position:'asc'}}}});
  const orders=[];
  for(let i=0;i<2;i++){
    const order=await db.workOrder.create({data:{code:marker+'-'+i,productName:'线束',specification:marker,drawingLibraryItemId:item.id,productionTargetQty:40,uncompletedQty:'40',completedQty:'0',stage:'backend',status:'processing',planActive:true,planType:'managed_plan',startedAt:new Date(),qrTicket:{create:{publicCode:randomUUID().replaceAll('-','')}},
      processRoute:{create:{templateName:marker,templateVersion:1,routeSource:'product_time_profile',productTimeProfileId:profile.id,productTimeProfileVersion:1,reportingPolicy:'free_sequence',status:'in_progress',confirmedAt:new Date(),startedAt:new Date(),
        steps:{create:profile.entries.map((entry,index)=>({processDefinitionId:entry.processDefinitionId,processCode:definitions[index].code,processName:definitions[index].name,stageGroup:'backend',position:index+1,sequenceGroup:index+1,status:index===0?'current':'pending',inputQty:index===0?40:0,productTimeProfileId:profile.id,productTimeEntryId:entry.id,productTimeProfileVersion:1,standardSource:'product_profile',timeBasis:'per_unit',standardMillisecondsPerUnit:1000,unitsPerProduct:1,unitLabel:'套'}))}}}},include:{processRoute:{include:{steps:{orderBy:{position:'asc'}}}},qrTicket:true}});
    orders.push({id:order.id,code:order.code,routeId:order.processRoute.id,firstStepId:order.processRoute.steps[0].id,publicCode:order.qrTicket.publicCode});
  }
  return {...f,marker,itemId:item.id,profileId:profile.id,routeOrders:orders,replacementDefinitionId:definitions[3].id};
}
main().then(value=>console.log(JSON.stringify(value))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
