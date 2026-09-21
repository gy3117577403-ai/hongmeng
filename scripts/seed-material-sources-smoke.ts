import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { naturalProductionWeek } from '../lib/production-execution';
import { mutateWarehouseException, mutateMaterialFollowUp } from '../lib/material-exception-service';
async function main(){
 if(process.env.MATERIAL_QA_ALLOW!=='disposable-material-runtime')throw Error('Disposable material QA acknowledgement required');
 const marker='MATQ-'+randomUUID().slice(0,8),password='Disposable-Material-211!A';
 const user=await prisma.user.create({data:{username:marker+'-admin',displayName:'物料验收管理',passwordHash:await bcrypt.hash(password,10),laborRole:'ADMIN',mustChangePassword:false,accessGrants:{create:{profile:'ADMIN_GLOBAL',scopeKey:marker+':admin'}}}});
 const warehouseDepartment=await prisma.department.findUniqueOrThrow({where:{code:'WAREHOUSE'}});
 const warehouse=await prisma.user.create({data:{username:marker+'-warehouse',displayName:'仓库验收员',passwordHash:await bcrypt.hash(password,10),laborRole:'EMPLOYEE',mustChangePassword:false,accessGrants:{create:{profile:'DEPARTMENT_FULL',departmentId:warehouseDepartment.id,scopeKey:marker+':warehouse'}}}});
 const procurement=await prisma.department.findUniqueOrThrow({where:{code:'PROCUREMENT'}});
 const reader=await prisma.user.create({data:{username:marker+'-reader',displayName:'只读验收员',passwordHash:await bcrypt.hash(password,10),laborRole:'EMPLOYEE',mustChangePassword:false,accessGrants:{create:{profile:'GM_OFFICE_READER_APPROVER',scopeKey:marker+':reader'}}}});
 let liqin=await prisma.user.findUnique({where:{username:'liqin211'}});
 if(!liqin)liqin=await prisma.user.create({data:{username:marker+'-liqin',displayName:'物料协同验收员',passwordHash:await bcrypt.hash(password,10),laborRole:'EMPLOYEE',mustChangePassword:false,accessGrants:{create:{profile:'MATERIAL_FOLLOW_UP_OPERATOR',departmentId:procurement.id,scopeKey:marker+':material'}}}});
 const week=naturalProductionWeek(),tasks=[];
 for(let i=0;i<46;i++){
  const historic=i===45; const work=await prisma.workOrder.create({data:{code:marker+'-'+i,productName:['车身控制线束','连接线','传感器组件'][i%3],specification:i===0?'2282152-1 定制线束长1米':'HL-MAT-'+String(i).padStart(3,'0'),customerName:['杭州迈斯嘉','杭州昆泰','上海易炬'][i%3],stage:'not_issued',productionTargetQty:40+i,planType:'weekly_plan',planActive:!historic,weekStartDate:historic?new Date(week.start.getTime()-14*86400000):week.start,weekEndDate:historic?new Date(week.end.getTime()-14*86400000):week.end}});
  const initial=await prisma.warehouseMaterialTask.create({data:{workOrderId:work.id}});
  const source=i%3===0?'PURCHASED':i%3===1?'CUSTOMER':'UNKNOWN';
  const first=await mutateWarehouseException(initial.id,{version:0,action:'report_exception',exceptionType:'shortage',exceptionNote:source==='CUSTOMER'?'客户壳体尚未送达，需确认发货安排':'端子缺 20 个，需分批补齐',materialModel:i%2?'壳体-B':'端子-A',supplySource:source,shortageQuantity:20,ownerId:liqin.id},user.id,true);
  if(i===0)await mutateWarehouseException(initial.id,{version:first.version,action:'report_exception',exceptionType:'shortage',exceptionNote:'另缺客供保护套 8 个',materialModel:'保护套-C',supplySource:'CUSTOMER',shortageQuantity:8,ownerId:liqin.id},user.id,true);
  const follow=await prisma.materialFollowUpTask.findFirstOrThrow({where:{warehouseTaskId:initial.id},orderBy:{createdAt:'asc'}});
  if(i<5)await mutateMaterialFollowUp(follow.id,{version:follow.version,action:'update',ownerId:liqin.id,status:'WAITING_ARRIVAL',expectedAt:new Date(Date.now()+2*86400000).toISOString().slice(0,10),receivedQuantity:i===0?6:0,note:'已与供方核对，分批送达，剩余物料持续跟进。'},liqin.id);
  tasks.push({id:initial.id,workOrderId:work.id,followId:follow.id,source,historic});
 }
 const result={marker,password,admin:{id:user.id,username:user.username},warehouse:{id:warehouse.id,username:warehouse.username},liqin:{id:liqin.id,username:liqin.username},reader:{id:reader.id,username:reader.username},tasks};
 const path=process.argv[2]||'.docker/material211-fixture.json';writeFileSync(path,JSON.stringify(result));
 console.log(JSON.stringify({seeded:true,workOrders:tasks.length,mixedExceptions:true,historyCarryover:true,fixturePath:path}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
