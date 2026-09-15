import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.REALTIME_HOURS_QA_ALLOW,'disposable-realtime-hours-runtime');
const base=process.env.REALTIME_HOURS_QA_BASE||'http://127.0.0.1:3183';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const fixture=JSON.parse((await fs.readFile(process.env.REALTIME_HOURS_QA_FIXTURE,'utf8')).replace(/^\uFEFF/,''));
const output=process.env.REALTIME_HOURS_QA_OUTPUT||'output/realtime-hours-v183/http.json';
const cookies={},checks=[]; const hour=3600000;
async function call(url,method='GET',data,who='actor',expected=200){
 const res=await fetch(base+url,{method,signal:AbortSignal.timeout(180000),headers:{Origin:base,...(cookies[who]?{Cookie:cookies[who]}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 const raw=await res.text();let body;try{body=JSON.parse(raw)}catch{body=raw};
 assert.equal(res.status,expected,`${method} ${url}: ${raw.slice(0,1500)}`); checks.push({url,method,status:res.status});
 if(url==='/api/auth/login')cookies[who]=res.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];return body;
}
for(const who of ['actor','reviewer'])await call('/api/auth/login','POST',{username:fixture[who].username,password:fixture.password},who);
async function hours(index=0){ const report=await call(`/api/reports/employee-attainment?period=today&date=${fixture.date}&employeeId=${fixture.employees[index].id}`);return report.report.rows.find(r=>r.employee.id===fixture.employees[index].id); }
function credit(row,production,abnormal=0,other=0,pending=0){assert.equal(row.standardLaborMilliseconds,production*hour,'production');assert.equal(row.exemptAbnormalMilliseconds,abnormal*hour,'abnormal');assert.equal(row.otherWorkMilliseconds,other*hour,'other');assert.equal(row.attainmentNumeratorMilliseconds,(production+abnormal+other)*hour,'numerator');assert.equal(row.pendingMatchingMilliseconds,pending*hour,'pending');}
async function complete(orderIndex,stepIndex,employees=[fixture.employees[0].id],extra={},expected=200){const o=fixture.orders[orderIndex];const context=await call(`/api/process-management/routes/${o.routeId}/completions?stepId=${o.steps[stepIndex]}`);const body={stepId:o.steps[stepIndex],processedQty:10,defectQty:0,workDate:fixture.date,employeeIds:employees,idempotencyKey:randomUUID(),expectedRouteVersion:context.data.routeVersion,...extra};const url=`/api/process-management/routes/${o.routeId}/completions`;const result=await call(url,'POST',body,'actor',expected);return {result,body,url};}
const outcomes=async()=> (await call('/api/reports/operations?period=week&date='+fixture.date)).report.weeklyPlan.find(w=>w.key===fixture.weekStart);
const initialOutcome=await outcomes();
credit(await hours(),0);
const rear=await complete(0,1);credit(await hours(),2,0,0,2);
assert.equal((await outcomes()).completedQuantity,initialOutcome.completedQuantity);
await call(rear.url,'POST',rear.body);credit(await hours(),2,0,0,2);
await complete(0,0);credit(await hours(),3);
assert.equal((await outcomes()).completedQuantity,initialOutcome.completedQuantity+10);
assert.equal((await outcomes()).completedBatches,initialOutcome.completedBatches+1);
let other=(await call('/api/other-work-times','POST',{employeeId:fixture.employees[0].id,workDate:fixture.date,categoryId:fixture.categoryId,requestedMinutes:60,description:'测试设备整理和工作准备',backfillReason:'管理员隔离验收补录',idempotencyKey:randomUUID()})).row;
credit(await hours(),3);
other=(await call(`/api/other-work-times/${other.id}`,'PATCH',{action:'SUBMIT',version:other.version})).row;credit(await hours(),3,0,1);assert.equal((await hours()).pendingReviewMilliseconds,hour);
other=(await call(`/api/other-work-times/${other.id}`,'PATCH',{action:'APPROVE',version:other.version,approvedMinutes:60},'reviewer')).row;credit(await hours(),3,0,1);
let abnormal=(await call('/api/abnormal-time-events','POST',{title:'隔离验收设备异常',category:'equipment_tooling',workDate:fixture.date,durationMinutes:30,employeeIds:[fixture.employees[0].id],reason:'设备维护实际工作半小时'},'actor',201)).event;
credit(await hours(),3,.5,1);assert.equal((await hours()).pendingReviewMilliseconds,hour/2);
abnormal=(await call(`/api/abnormal-time-events/${abnormal.id}/quality`,'POST',{decision:'confirmed',expectedVersion:abnormal.version,note:'隔离验收工时核对'},'reviewer')).event;credit(await hours(),3,.5,1);assert.equal((await hours()).pendingReviewMilliseconds,0);
const crew=await complete(2,1,fixture.employees.map(e=>e.id));credit(await hours(),4,.5,1,1);credit(await hours(1),1,0,0,1);
const withdrawUrl=crew.url+'/'+crew.result.data.completionId+'/withdraw';
const preview=await call(withdrawUrl);await call(withdrawUrl,'POST',{expectedRouteVersion:preview.data.routeVersion,category:'REPORTING_ERROR',idempotencyKey:randomUUID()});
credit(await hours(),3,.5,1);credit(await hours(1),0);
await complete(1,0);credit(await hours(),4,.5,1);
const wip=(await call('/api/wip','POST',{action:'enter',batchId:fixture.orders[1].batchId,quantity:10,reason:'隔离验收半成品转仓',idempotencyKey:randomUUID()})).data;

const futureWeek=new Date(new Date(fixture.weekStart+'T00:00:00Z').getTime()+7*86400000).toISOString().slice(0,10);
const allocation=(await call('/api/wip','POST',{action:'schedule',lotId:wip.id,quantity:10,targetWeekStartDate:futureWeek,reason:'隔离验收下周续作',idempotencyKey:randomUUID()})).data;

const pending=await complete(1,1,[fixture.employees[0].id],{allowPending:true,wipAllocationId:allocation.id,source:{kind:'WIP',lotId:wip.id,allocationId:allocation.id}},202);
credit(await hours(),6,.5,1,2);
const transferred=await outcomes();assert.equal(transferred.completedQuantity,initialOutcome.completedQuantity+10);
assert.equal(transferred.plannedQuantity,initialOutcome.plannedQuantity-10);
const recovery=(await call('/api/process-report-submissions/'+pending.result.submission.id+'/preview')).data;
const option=recovery.sourceOptions.find(o=>o.allocationId===allocation.id);
assert.ok(option);
await call('/api/process-report-submissions/'+pending.result.submission.id+'/resolve','POST',{expectedVersion:pending.result.submission.version,expectedRouteVersion:recovery.routeVersion,sourceKey:option.key,sourceVersion:option.version,confirmAdvanceSchedule:true});
credit(await hours(),6,.5,1,0);
const final=await hours();assert.equal(final.attainmentBasisPoints,9868); // 7.5 / (8 * .95)
const outcome=await outcomes();assert.equal(outcome.completedQuantity,initialOutcome.completedQuantity+20);assert.equal(outcome.plannedQuantity,initialOutcome.plannedQuantity);
const summary=(await call('/api/dashboard/production-summary?scope=current')).data;
assert.equal(summary.quantityTotals.completedQty,outcome.completedQuantity);assert.equal(summary.quantityTotals.targetQty,outcome.plannedQuantity);
assert.equal(summary.planTotals.completedOrders,outcome.completedBatches);assert.equal(summary.planTotals.totalOrders,outcome.plannedBatches);
const operations=await call(`/api/reports/operations?period=week&date=${fixture.date}`);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({passed:true,at:new Date().toISOString(),marker:fixture.marker,checks,final,operations},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
