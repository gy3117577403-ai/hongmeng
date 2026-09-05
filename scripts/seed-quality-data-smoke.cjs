// Disposable acceptance fixtures only. Never run against a business database.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
if (process.env.QUALITY_DATA_QA_ALLOW !== 'disposable-quality-runtime') throw new Error('Explicit disposable runtime guard required');
const prisma = new PrismaClient();
async function main() {
  const marker = 'qd' + randomUUID().replaceAll('-', '').slice(0, 8), password = 'Inspection-Smoke-2026!Z';
  const departments = await prisma.department.findMany({ where: { code: { in: ['PRODUCTION','QUALITY','PROCESS'] } } });
  const department = code => { const found = departments.find(d => d.code === code); if (!found) throw new Error('Seed departments first'); return found; };
  const users = {};
  for (const [kind,profile,dept,report] of [
    ['quality','QUALITY_REVIEWER','QUALITY',false],
    ['leader','WORKSHOP_TEAM_LEADER','PRODUCTION',true],
    ['tooling','QUALITY_DATA_OPERATOR','PRODUCTION',true],
    ['employee','FIELD_REPORTER','PRODUCTION',false],
    ['process','PROCESS_SPECIALIST','PROCESS',false],
    ['admin','ADMIN_GLOBAL','QUALITY',false],
  ]) {
    const employee = await prisma.employee.create({ data: { employeeNo: marker + '-' + kind, name: {quality:'品质检验员',leader:'压接组长',tooling:'调模员',employee:'生产员工',process:'工艺专员',admin:'验收管理员'}[kind], departmentId: department(dept).id, department: department(dept).name, position:kind==='tooling'?'调模':'验收岗位', team:'质量验收班组', hireDate:new Date('2026-01-01') } });
    const account = await prisma.user.create({ data: { username:marker+'-'+kind,displayName:employee.name,passwordHash:await bcrypt.hash(password,10),employeeId:employee.id,laborRole:kind==='admin'?'ADMIN':kind==='leader'?'TEAM_LEAD':'EMPLOYEE',isActive:true,accountStatus:'ACTIVE',mustChangePassword:false,accessGrants:{ create:[
      { profile, departmentId: department(dept).id, scopeKey:kind==='leader'?'TEAM:quality-qa':'GLOBAL:QUALITY_QA',grantType:kind==='tooling'?'CONCURRENT':'PRIMARY',effectiveFrom:new Date('2026-01-01') },
      ...(report?[{profile:'FIELD_REPORTER',departmentId:department(dept).id,scopeKey:'EMPLOYEE:'+employee.id,grantType:kind==='tooling'?'PRIMARY':'CONCURRENT',effectiveFrom:new Date('2026-01-01')}]:[]),
    ] } }, include: { accessGrants:true } });
    users[kind]={id:account.id,username:account.username,employeeId:employee.id,grants:account.accessGrants.map(g=>({id:g.id,profile:g.profile,version:g.version}))};
  }
  const orders = [];
  for (let index=1;index<=2;index++){
    const code = marker + '-ORDER-' + index, publicCode = randomUUID().replaceAll('-','');
    const order=await prisma.workOrder.create({data:{
      code,businessCode:marker+'-WO-'+index,sourceOrderNo:marker+'-SO-'+index,customerName:'质量验收客户',productName:'连接线束',specification:'HL-2609-A（验收样例）',
      stage:index===1?'frontend':'completed',status:'processing',productionTargetQty:200,uncompletedQty:'200',completedQty:index===1?'0':'200',planType:'managed_plan',planActive:true,
      processRoute:{create:{templateName:'质量验收工艺',templateVersion:1,status:index===1?'in_progress':'completed',version:1,confirmedAt:new Date(),startedAt:new Date(),steps:{create:{processCode:'QD-CRIMP',processName:'端子压接',stageGroup:'frontend',position:1,sequenceGroup:1,standardSource:'integration_test',timeBasis:'per_unit',unitLabel:'套',standardMillisecondsPerUnit:3000,inputQty:200,status:index===1?'current':'completed'}}}},
      qrTicket:{create:{publicCode}},
    }});
    const plan=await prisma.productionPlanOrder.create({data:{sourceOrderNo:order.sourceOrderNo,sourceLineNo:1,customerName:order.customerName,productName:order.productName,specification:order.specification,orderQuantity:200,orderDate:new Date(),customerDueDate:new Date(Date.now()+86400000),batches:{create:{batchNo:index,quantity:200,weekStartDate:new Date(),weekEndDate:new Date(Date.now()+6*86400000),plannedCompletionDate:new Date(Date.now()+86400000),workOrderId:order.id,releaseState:'active'}}}});
    orders.push({id:order.id,code,publicCode,planOrderId:plan.id});
  }
  return {marker,password,users,orders};
}
main().then(data=>console.log(JSON.stringify(data))).finally(()=>prisma.$disconnect());
