import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { createOtherWork, commandOtherWork, detailOtherWork, listOtherWork, mutateOtherWorkAttachment, otherWorkToday } from '../lib/other-work-time-service';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import { loadEmployeeHoursReport } from '../lib/employee-hours-report-service';
import { employeeHoursOperationsRows } from '../lib/employee-hours-operations';
import { employeeReportRange } from '../lib/process-time';
import type { CurrentUserDTO } from '../types';

const enabled=process.env.RUN_DB_INTEGRATION==='1';
const h=3600000;
test('other work independent workflow, concurrent approval, evidence lock and report reconciliation', {skip:!enabled}, async t=>{
  const url=new URL(process.env.DATABASE_URL || '');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.ok(url.pathname==='/hongmeng_other_hours_v134147' && url.port==='55448' || url.pathname==='/hongmeng_ci' && process.env.CI==='true', 'Only isolated QA or named CI databases');
  const marker='OTHER-IT-'+randomUUID().slice(0,8);
  const today=otherWorkToday();
  const prior=new Date(new Date(today+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const team=await prisma.productionTeam.create({data:{code:marker,name:marker}});
  const people=await Promise.all([0,1,2,3].map(n=>prisma.employee.create({data:{employeeNo:marker+'-'+n,name:marker+'-'+n,team:team.name,department:'生产部',hireDate:new Date(prior+'T00:00:00Z')}})));
  const users=await Promise.all(people.map((e,n)=>prisma.user.create({data:{username:marker+'-'+n,displayName:e.name,passwordHash:'isolated',employeeId:e.id,laborRole:n===3?'ADMIN':'EMPLOYEE'}})));
  const grants: AccessGrant[]=[{profile:'FIELD_REPORTER',grantType:'PRIMARY',scopeKey:'SELF'},{profile:'WORKSHOP_TEAM_LEADER',grantType:'PRIMARY',scopeKey:'TEAM:'+team.id},{profile:'WORKSHOP_SUPERVISOR',grantType:'PRIMARY',scopeKey:'WORKSHOP:PRODUCTION'},{profile:'ADMIN_GLOBAL',grantType:'PRIMARY',scopeKey:'GLOBAL'}];
  for(let n=0;n<users.length;n++) await prisma.userAccessGrant.create({data:{userId:users[n].id,profile:grants[n].profile,grantType:'PRIMARY',scopeKey:grants[n].scopeKey}});
  const actors=users.map((u,n)=>({...u,access:resolveAccessContext([grants[n]]),dailyPlanningTeamIds:[]} as unknown as CurrentUserDTO));
  const [operator,leader,supervisor,admin]=actors;
  const workInput=(description:string,minutes=120)=>({workDate:prior,categoryId:'other-sample',requestedMinutes:minutes,description,backfillReason:'昨天安排工作，今天补报',idempotencyKey:randomUUID()});
  const commands=async (actor:CurrentUserDTO,id:string,action:string,extra={})=>{
    const row=await prisma.otherWorkTimeRequest.findUniqueOrThrow({where:{id}});
    return commandOtherWork(actor,id,{action,version:row.version,...extra});
  };
  const report=async()=>{
    const range=employeeReportRange('custom',today,prior,today);
    return (await loadEmployeeHoursReport({...range,period:'custom',employeeIdConstraint:people[0].id})).report;
  };
  let rowId='';
  try {
    await t.test('idempotent draft binds employee server-side and never creates order facts',async()=>{
      const before=await Promise.all([prisma.abnormalTimeEvent.count(),prisma.processLaborPool.count(),prisma.processExecution.count()]);
      const data=workInput('协助样品打端子，独立登记');
      const [a,b]=await Promise.all([createOtherWork(operator,data),createOtherWork(operator,data)]);
      assert.equal(a.id,b.id);rowId=a.id;assert.equal(a.employeeId,people[0].id);
      await assert.rejects(createOtherWork(operator,{...data,requestedMinutes:121}),/不同内容/);
      await assert.rejects(createOtherWork(operator,{...workInput('篡改员工'),employeeId:people[1].id}),/本人/);
      assert.deepEqual(await Promise.all([prisma.abnormalTimeEvent.count(),prisma.processLaborPool.count(),prisma.processExecution.count()]),before);
      const detail=await detailOtherWork(operator,rowId);
      assert.equal(detail.row.teamIdSnapshot,team.id);
    });
    await t.test('submit locks evidence, forbids self review and foreign scope, one concurrent reviewer wins',async()=>{
      const draft=await prisma.otherWorkTimeRequest.findUniqueOrThrow({where:{id:rowId}});
      const attached=await mutateOtherWorkAttachment(operator,rowId,draft.version,{objectKey:marker+'/photo.jpg',mimeType:'image/jpeg',size:100,originalName:'photo.jpg'});
      const pending=await commandOtherWork(operator,rowId,{action:'SUBMIT',version:attached.version});
      await assert.rejects(mutateOtherWorkAttachment(operator,rowId,pending.version,{deleteId:attached.attachments[0].id}),/照片/);
      await assert.rejects(commandOtherWork(operator,rowId,{action:'APPROVE',version:pending.version}),/自审|范围/);
      const foreign={...leader,access:resolveAccessContext([{...grants[1],scopeKey:'TEAM:another-team'}])};
      await assert.rejects(commandOtherWork(foreign,rowId,{action:'APPROVE',version:pending.version}));
      assert.equal((await report()).summary.otherWorkMilliseconds,0);
      const results=await Promise.allSettled([commandOtherWork(leader,rowId,{action:'APPROVE',version:pending.version}),commandOtherWork(supervisor,rowId,{action:'APPROVE',version:pending.version})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(await prisma.otherWorkTimeReview.count({where:{requestId:rowId,action:'APPROVE'}}),1);
      const approved=await prisma.otherWorkTimeRequest.findUniqueOrThrow({where:{id:rowId}});
      assert.equal(approved.status,'APPROVED');assert.equal(approved.approvedMinutes,120);
      assert.ok(await prisma.systemNotificationRecipient.count({where:{userId:operator.id,notification:{sourceType:'other_work_time',sourceId:rowId}}}));
    });
    await t.test('late approval, missing attendance, historical eligibility, daily and period formulas agree',async()=>{
      await prisma.employee.update({where:{id:people[0].id},data:{attainmentEligible:false,attainmentStream:'excluded',team:'已调离的新班组'}});
      let result=await report();
      assert.equal(result.summary.otherWorkMilliseconds,2*h);assert.equal(result.summary.attainmentBasisPoints,null);
      assert.equal(result.rows[0].days.find(d=>d.date===prior)?.otherWorkMilliseconds,2*h);
      await prisma.attendanceRecord.create({data:{employeeId:people[0].id,workDate:new Date(prior+'T00:00:00Z'),status:'confirmed',actualMilliseconds:8*h,plannedMilliseconds:8*h,segments:[],departmentSnapshot:'生产部',teamSnapshot:team.name,attainmentEligibleSnapshot:true,attainmentStreamSnapshot:'batch'}});
      result=await report();
      assert.equal(result.summary.attainmentBasisPoints,2632);assert.equal(result.summary.attendanceMilliseconds,8*h);
      assert.equal(result.summary.attainmentCapacityMilliseconds,7.6*h);
      const operation=employeeHoursOperationsRows(result.rows,[prior,today])[0];
      assert.equal(operation.otherWorkMilliseconds,2*h);assert.equal(operation.attainmentBasisPoints,2632);
      assert.equal(operation.days[0].otherWorkMilliseconds,2*h);
      assert.equal(operation.days[0].teamSnapshot,team.name,'Daily reports preserve the attendance team after transfer');
      const historicalDraft=await createOtherWork(operator,workInput('调班后的历史补报',15));
      assert.equal(historicalDraft.teamSnapshot,team.name);
      assert.equal(historicalDraft.teamIdSnapshot,team.id,'Historical reviewer team must not be the employee current team');
      for(const period of ['today','week','month'] as const) {
        const range=employeeReportRange(period,prior);
        const r=(await loadEmployeeHoursReport({...range,period,employeeIdConstraint:people[0].id})).report;
        assert.equal(r.summary.otherWorkMilliseconds,2*h);assert.equal(r.summary.attainmentBasisPoints,2632);
      }
    });
    await t.test('correction and void preserve audit, subtract original day and require new approval',async()=>{
      await commands(operator,rowId,'CORRECTION_REQUEST',{reason:'核对安排后需要更正时长'});
      await assert.rejects(commands(leader,rowId,'VOID',{reason:'越权作废'}),/管理员/);
      await commands(admin,rowId,'VOID',{reason:'核对后作废原记录，重新申报'});
      assert.equal((await report()).summary.otherWorkMilliseconds,0);
      await assert.rejects(commands(admin,rowId,'APPROVE'),/已处理/);
      const copied=await createOtherWork(operator,{...workInput('更正协助样品工作',100),correctionOfId:rowId});
      await commands(operator,copied.id,'SUBMIT');
      await commands(supervisor,copied.id,'APPROVE',{approvedMinutes:90,reason:'核减休息间隔十分钟'});
      assert.equal((await report()).summary.otherWorkMilliseconds,90*60000);
      assert.equal((await detailOtherWork(operator,copied.id)).row.correctionOfId,rowId);
    });
    await t.test('reject, edit and withdraw retain history; precise overlaps and future work are blocked',async()=>{
      const draft=await createOtherWork(operator,workInput('临时公共辅助事务',30));
      await commands(operator,draft.id,'SUBMIT');await commands(leader,draft.id,'REJECT',{reason:'请补充具体工作说明'});
      await commands(operator,draft.id,'EDIT',{...workInput('修改后的公共辅助事务',30)});
      await commands(operator,draft.id,'SUBMIT');await commands(operator,draft.id,'WITHDRAW');
      const detail=await detailOtherWork(operator,draft.id);
      assert.equal(detail.row.status,'WITHDRAWN');assert.ok(detail.row.reviews.some(r=>r.action==='REJECT'));
      const interval={startedAt:prior+'T10:00:00+08:00',endedAt:prior+'T11:00:00+08:00'};
      const a=await createOtherWork(operator,{...workInput('协助整理样品工具',60),...interval});
      const b=await createOtherWork(operator,{...workInput('另一项重叠安排',30),...interval});
      await commands(operator,a.id,'SUBMIT');await assert.rejects(commands(operator,b.id,'SUBMIT'),/重叠/);
      await assert.rejects(createOtherWork(operator,{...workInput('未来安排'),workDate:'2099-01-01'}),/未来/);
      await assert.rejects(createOtherWork(operator,{...workInput('无效日期'),workDate:'2026-02-30'}),/日期/);
      const scoped=await listOtherWork(leader,new URLSearchParams({scope:'manage'}));
      assert.ok(scoped.rows.some(r=>r.id===a.id));
      await assert.rejects(listOtherWork(operator,new URLSearchParams({scope:'manage'})),/管理权限/);
    });
  } finally {
    const ids=(await prisma.otherWorkTimeRequest.findMany({where:{employeeId:{in:people.map(p=>p.id)}},select:{id:true}})).map(r=>r.id);
    await prisma.systemNotification.deleteMany({where:{sourceType:'other_work_time',sourceId:{in:ids}}});
    await prisma.otherWorkTimeReview.deleteMany({where:{requestId:{in:ids}}});
    await prisma.otherWorkTimeAttachment.deleteMany({where:{requestId:{in:ids}}});
    await prisma.otherWorkTimeRequest.updateMany({where:{id:{in:ids}},data:{correctionOfId:null}});
    await prisma.otherWorkTimeRequest.deleteMany({where:{id:{in:ids}}});
    await prisma.attendanceRecord.deleteMany({where:{employeeId:{in:people.map(p=>p.id)}}});
    await prisma.userAccessGrant.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});
    await prisma.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
    await prisma.employee.deleteMany({where:{id:{in:people.map(p=>p.id)}}});
    await prisma.productionTeam.delete({where:{id:team.id}});
  }
});
