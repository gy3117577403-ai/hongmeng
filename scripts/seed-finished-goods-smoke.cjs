// Only for disposable release acceptance stacks. Never run against a business database.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
async function createFixture(db, count = 32) {
  if (process.env.FINISHED_GOODS_QA_ALLOW !== 'disposable-finished-goods-runtime') throw Error('Disposable finished goods runtime acknowledgement required');
  const marker = `FGQ-${randomUUID().slice(0, 8)}`;
  const password = 'Disposable-FG-2026!A';
  const department = await db.department.upsert({ where: { code: 'PRODUCTION' }, create: { code: 'PRODUCTION', name: '生产部' }, update: {} });
  const employee = await db.employee.create({ data: { employeeNo: `${marker}-E`, name: '成品仓验收员', department: '生产部', departmentId: department.id, isActive: true } });
  const user = await db.user.create({ data: { username: `${marker}-user`, displayName: '成品仓验收员', employeeId: employee.id, passwordHash: await bcrypt.hash(password,10), mustChangePassword: false, laborRole: 'EMPLOYEE', accessGrants: { create: { profile:'FIELD_REPORTER', departmentId:department.id, scopeKey:`EMPLOYEE:${employee.id}` } } } });
  const actor = await db.user.create({ data: { username: `${marker}-admin`, displayName: '成品仓验收管理', passwordHash: await bcrypt.hash(password,10), mustChangePassword:false, laborRole:'ADMIN', accessGrants:{ create:{profile:'ADMIN_GLOBAL',departmentId:department.id,scopeKey:`GLOBAL:${marker}`} } } });
  const today = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const lots = [];
  for (let i=0;i<count;i++) {
    const quantity = 20 + i % 4 * 20;
    const workOrder = await db.workOrder.create({ data: {
      code:`${marker}-${String(i+1).padStart(3,'0')}`, businessCode:`${marker}-${String(i+1).padStart(3,'0')}`,
      customerName: ['甲方设备','乙方制造','丙方机电'][i%3], productName:['连接线','控制线','传感器组件','显示模组','外壳组件'][i%5], specification:`HL-${String(i%5+1).padStart(2,'0')} / V1`,
      planType:'managed_plan',planActive:true,stage:'completed',status:'processing',productionTargetQty:quantity,uncompletedQty:String(quantity),completedQty:String(quantity),progress:100,
      processRoute:{create:{templateName:'成品验收路线',templateVersion:1,status:'completed',version:0,routeSource:'process_template',reportingPolicy:'free_sequence',confirmedAt:new Date(),completedAt:new Date(),steps:{create:{processCode:`${marker}-PACK`,processName:'包装',stageGroup:'backend',position:1,sequenceGroup:1,status:'completed',inputQty:quantity,processedQty:quantity,goodOutputQty:quantity,releasedGoodQty:quantity,standardSource:'legacy',timeBasis:'per_unit',standardMillisecondsPerUnit:3000,unitLabel:'件'}}}},
    }, include:{processRoute:{include:{steps:true}}} });
    const completion = await db.processCompletion.create({data:{workOrderId:workOrder.id,routeId:workOrder.processRoute.id,stepId:workOrder.processRoute.steps[0].id,workDate:new Date(`${today}T00:00:00Z`),processedQty:quantity,goodQty:quantity,defectQty:0,reportedUnitQty:quantity,reportedGoodUnitQty:quantity,reportedDefectUnitQty:0,coveredQty:quantity,coveredGoodQty:quantity,routeVersion:0,idempotencyKey:`${marker}-completion-${i}`,standardSource:'legacy',createdById:actor.id}});
    const movement = await db.processQuantityMovement.create({data:{completionId:completion.id,workOrderId:workOrder.id,sourceStepId:workOrder.processRoute.steps[0].id,type:'FINISHED_GOOD',quantity,sourceSequenceGroup:1,idempotencyKey:`${marker}-movement-${i}`}});
    const lot = await db.fgLot.findUniqueOrThrow({where:{movementId:movement.id}});
    if (lot.pending !== quantity || lot.available !== 0) throw Error('Automatic production intake failed');
    const planOrder = await db.productionPlanOrder.create({data:{sourceOrderNo:workOrder.code,sourceLineNo:1,customerName:workOrder.customerName,productName:workOrder.productName,specification:workOrder.specification,orderQuantity:quantity,orderDate:new Date(`${today}T00:00:00Z`),customerDueDate:new Date(`${today}T00:00:00Z`),batches:{create:{batchNo:1,quantity,workOrderId:workOrder.id,releaseState:'active',weekStartDate:new Date(`${today}T00:00:00Z`),weekEndDate:new Date(`${today}T00:00:00Z`),plannedCompletionDate:new Date(`${today}T00:00:00Z`)}}}});
    lots.push({id:lot.id,workOrderId:workOrder.id,workOrderCode:workOrder.code,quantity,movementId:movement.id,completionId:completion.id,routeId:workOrder.processRoute.id,stepId:workOrder.processRoute.steps[0].id,planOrderId:planOrder.id});
  }
  return {marker,password,user:{id:user.id,username:user.username,displayName:user.displayName},actor:{id:actor.id,username:actor.username,displayName:actor.displayName},lots,date:today};
}
module.exports={createFixture};
if (require.main === module || module.id === '[stdin]') {const db=new PrismaClient();createFixture(db,Number(process.env.FINISHED_GOODS_QA_ROWS)||32).then(data=>console.log(JSON.stringify(data))).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());}
