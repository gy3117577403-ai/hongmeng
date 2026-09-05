const {PrismaClient}=require('@prisma/client');
const {randomUUID}=require('node:crypto');
if(process.env.QUALITY_DATA_QA_ALLOW!=='disposable-quality-runtime')throw new Error('Disposable runtime acknowledgement required');
const prisma=new PrismaClient();
(async()=>{
  const marker=`QA-PLAN-REF-${randomUUID().slice(0,8)}`;
  const process=await prisma.processDefinition.create({data:{code:marker,name:'导入工时验收工序',stageGroup:'frontend',sortOrder:1}});
  const item=await prisma.drawingLibraryItem.create({data:{customerName:marker,productName:'计划工时验收线束',specification:marker,libraryKey:marker}});
  await prisma.productTimeProfile.create({data:{drawingLibraryItemId:item.id,version:1,status:'published',publishedAt:new Date(),entries:{create:{processDefinitionId:process.id,occurrenceKey:marker,position:1,sequenceGroup:1,timeBasis:'per_unit',unitMilliseconds:60000,occurrences:1,unitLabel:'套'}}}});
  console.log(JSON.stringify({id:item.id,customerName:item.customerName,specification:item.specification,unitMilliseconds:60000}));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
