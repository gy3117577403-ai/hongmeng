import fs from 'node:fs';
import {prisma} from '../lib/prisma';
import {createWorkOrderTravelerPrints,loadWorkOrderTravelerPrints} from '../lib/work-order-qr-service';
import {flattenQualityWarningPages} from '../lib/quality-warning-print-layout';
import assert from 'node:assert/strict';
if(!process.env.DATABASE_URL?.includes('@127.0.0.1:55453/hongmeng_quality_quick_v134153'))throw Error('Isolated quick QA required');
const fixture=JSON.parse(fs.readFileSync('.docker/quick-fixture.json','utf8'));
async function main(){
  for(const order of fixture.orders) {
    await prisma.workOrder.update({where:{id:order.id},data:{productionTargetQty:24,uncompletedQty:'24',completedQty:'0',status:'processing',planType:'managed_plan',planActive:true}});
    if(!await prisma.workOrderProcessRoute.findUnique({where:{workOrderId:order.id}}))await prisma.workOrderProcessRoute.create({data:{workOrderId:order.id,templateName:'验收装配路线',templateVersion:1,status:'in_progress',version:1,confirmedAt:new Date(),confirmedById:fixture.users.admin.id,startedAt:new Date(),routeSource:'process_template',steps:{create:{processCode:'QA-ASSEMBLY',processName:'装配',stageGroup:'frontend',position:1,sequenceGroup:1,standardSource:'integration_test',timeBasis:'per_unit',unitLabel:'套',standardMillisecondsPerUnit:3000,setupMilliseconds:0,unitsPerProduct:1,countsForEfficiency:true,inputQty:24,status:'current',startedAt:new Date()}}}});
  }
  if(process.argv.includes('--routes-only')){console.log('Dedicated field-report routes ready');return;}
  const records=await createWorkOrderTravelerPrints({workOrderIds:[fixture.orders[0].id],userId:fixture.users.admin.id,actor:'验收管理员',mode:'TRAVELER_QUALITY_WARNING',materials:['TRAVELER','QUALITY_WARNING']});
  assert.ok(records[0].items.some(item=>item.material==='QUALITY_WARNING'));
  const warnings=records[0].snapshot.qualityWarnings.filter(w=>w.reportNo.startsWith('QQ-'));assert.ok(warnings.length);assert.ok(warnings[0].attachments.length);assert.ok(flattenQualityWarningPages(warnings).length);
  const reloaded=await loadWorkOrderTravelerPrints([records[0].printId]);assert.deepEqual(reloaded[0].snapshot.qualityWarnings,records[0].snapshot.qualityWarnings);
  fs.writeFileSync('.docker/quick-print.json',JSON.stringify({printId:records[0].printId,url:'http://127.0.0.1:3123/production/qr-print?printIds='+records[0].printId,warningCount:warnings.length,photoCount:warnings[0].attachments.length,pages:flattenQualityWarningPages(warnings).length},null,2));
  console.log(JSON.stringify({ok:true,printId:records[0].printId,warningCount:warnings.length,pages:flattenQualityWarningPages(warnings).length}));
}
main().finally(()=>prisma.$disconnect());
