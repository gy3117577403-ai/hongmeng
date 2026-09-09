import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { otherWorkToday } from '../lib/other-work-time-service';
async function main() {
  const db=new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1','localhost'].includes(db.hostname) || db.port!=='55448' || !['/hongmeng_other_hours_v134147','/hongmeng_other_hours_v134147_release'].includes(db.pathname)) throw Error('Only dedicated other-hours QA database is allowed');
  const password=process.env.OTHER_HOURS_QA_PASSWORD;
  if(!password)throw Error('Missing private fixture password');
  const marker='OHQA-'+randomUUID().slice(0,7);
  const today=otherWorkToday();
  const prior=new Date(new Date(today+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const team=await prisma.productionTeam.create({data:{code:marker,name:'其他工时验收组 '+marker}});
  const passwordHash=await bcrypt.hash(password,10);
  const users=[];
  for(const [index, name, profile, scope, role] of [
    [0,'扫码员工','FIELD_REPORTER','SELF','EMPLOYEE'],
    [1,'验收组长','WORKSHOP_TEAM_LEADER','TEAM:'+team.id,'EMPLOYEE'],
    [2,'验收主管','WORKSHOP_SUPERVISOR','WORKSHOP:PRODUCTION','EMPLOYEE'],
    [3,'验收管理员','ADMIN_GLOBAL','GLOBAL','ADMIN'],
    [4,'外组组长','WORKSHOP_TEAM_LEADER','TEAM:outside-other-hours','EMPLOYEE'],
  ] as const){
    const employee=await prisma.employee.create({data:{employeeNo:marker+'-'+index,name,team:team.name,department:'生产部',attendanceGroup:'PRODUCTION',hireDate:new Date(prior+'T00:00:00Z')}});
    const user=await prisma.user.create({data:{username:marker+'-'+index,passwordHash,displayName:name,employeeId:employee.id,laborRole:role,
      accessGrants:{create:{profile,scopeKey:scope,grantType:'PRIMARY'}}}});
    users.push({id:user.id,username:user.username,employeeId:employee.id,name});
  }
  for(const date of [prior,today]) await prisma.attendanceRecord.create({data:{employeeId:users[0].employeeId,workDate:new Date(date+'T00:00:00Z'),status:'confirmed',
    attendanceType:'normal',plannedMilliseconds:8*3600000,actualMilliseconds:8*3600000,segments:[],departmentSnapshot:'生产部',teamSnapshot:team.name,attainmentEligibleSnapshot:true,attainmentStreamSnapshot:'batch'}});
  // Production output is a separate real source fact, so the HTTP report can prove the 6 + 2 example.
  const order=await prisma.workOrder.create({data:{code:marker,productName:'其他工时隔离验收产品',stage:'backend',
    processRoute:{create:{templateName:'隔离路线',templateVersion:1,steps:{create:{processCode:'QATEST',processName:'压接',stageGroup:'backend',position:1}}}}},include:{processRoute:{include:{steps:true}}}});
  const step=order.processRoute!.steps[0];
  await prisma.processExecution.create({data:{employeeId:users[0].employeeId,stepId:step.id,startedAt:new Date(prior+'T08:00:00+08:00'),endedAt:new Date(prior+'T14:00:00+08:00'),
    unitLabel:'件',standardMillisecondsPerUnit:360000,breakMilliseconds:0,goodQty:60,scrapQty:0,reworkQty:0,standardLaborMilliseconds:6*3600000,actualLaborMilliseconds:6*3600000,attainmentBasisPoints:10000}});
  mkdirSync('.docker',{recursive:true});
  writeFileSync('.docker/other-hours-fixture.json',JSON.stringify({marker,today,prior,teamId:team.id,teamName:team.name,users,workOrderId:order.id,password},null,2));
  console.log('Created isolated other-hours browser and HTTP fixture: '+marker);
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
