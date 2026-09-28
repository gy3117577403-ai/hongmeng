import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { inventoryCommand, worklogCommand, getToolingJob, getToolingInventory, listToolingWork } from '../lib/tooling-worklog-service';
import { TOOLING_POSITIONS, shanghaiDay } from '../lib/tooling-worklog-domain';
import { loadEmployeeHoursReport } from '../lib/employee-hours-report-service';
import { employeeReportRange } from '../lib/process-time';

test('tooling inventory, timing, shared hours and concurrency close the full loop',{skip:process.env.RUN_DB_INTEGRATION!=='1'},async t=>{
  const url=new URL(process.env.DATABASE_URL||'');assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&['/tooling250','/hongmeng_ci'].includes(url.pathname),'Only isolated QA or CI database');
  const prefix='TOOL-IT-'+randomUUID().slice(0,7), employees=await Promise.all([1,2].map(n=>prisma.employee.create({data:{employeeNo:prefix+n,name:prefix+n,team:'调模组',department:'生产部'}})));
  const actors=await Promise.all(employees.map(e=>prisma.user.create({data:{employeeId:e.id,username:e.employeeNo,displayName:e.name,passwordHash:'integration-only',laborRole:'EMPLOYEE'}})));
  const blades=await Promise.all(['03301220022','散刀'].map(model=>prisma.terminalToolingBlade.create({data:{model,normalizedKey:prefix+model,compatiblePositions:[...TOOLING_POSITIONS],positionSpecs:{create:TOOLING_POSITIONS.map(position=>({position,specification:'2.7×2.4'}))}}})));
  const ids:string[]=[];
  const inv=(action:string,extra:Record<string,unknown>={})=>inventoryCommand(actors[0],{key:randomUUID(),action,bladeId:blades[0].id,box:3,quantity:1,kind:'KIT',...extra});
  const cmd=async(id:string,action:string,extra:Record<string,unknown>={})=>{const j=await getToolingJob(id);return worklogCommand(actors.find(a=>a.id===j.actorId)!,{key:randomUUID(),jobId:id,version:j.version,action,...extra});};
  try{
    await t.test('unknown quantity is different from explicitly counted zero; registration is idempotent',async()=>{
      let b=(await getToolingInventory()).find(x=>x.id===blades[0].id)!;assert.equal(b.stock.registered,false);
      const payload={key:randomUUID(),action:'REGISTER',bladeId:blades[0].id,box:3,quantity:0,kind:'KIT'};await Promise.all([inventoryCommand(actors[0],payload),inventoryCommand(actors[0],payload)]);
      b=(await getToolingInventory()).find(x=>x.id===blades[0].id)!;assert.equal(b.stock.registered,true);assert.equal(b.stock.total,0);
      await inv('ADD');b=(await getToolingInventory()).find(x=>x.id===blades[0].id)!;assert.equal(b.stock.completeKits,1);assert.equal(b.stock.total,4);
    });
    await t.test('two employees cannot allocate the last kit; same request retry returns the existing job',async()=>{
      const stocks=await prisma.toolingStock.findMany({where:{bladeId:blades[0].id}});
      const payload={key:randomUUID(),action:'START',kind:'TUNING',specification:prefix+'端子',choices:stocks.map(s=>({position:s.position,bladeId:s.bladeId,stockId:s.id}))};
      const results=await Promise.allSettled(actors.map(a=>worklogCommand(a,payload)));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const winner=results.findIndex(x=>x.status==='fulfilled'), result=(results[winner] as PromiseFulfilledResult<Record<string,unknown>>).value;
      const jobId=String(result.jobId);ids.push(jobId);
      assert.deepEqual(await worklogCommand(actors[winner],payload),result);assert.equal(await prisma.toolingJob.count({where:{employeeId:actors[winner].employeeId!,activeEmployee:{not:null}}}),1);
      await assert.rejects(worklogCommand(actors[winner],{...payload,key:randomUUID(),choices:[]}),/已有进行中/);
      await assert.rejects(worklogCommand(actors[1-winner],{key:randomUUID(),action:'PAUSE',jobId,version:1,reason:'测试'}),/本人/);
    });
    await t.test('swapping one position preserves old combination and releases original stock',async()=>{
      const jobId=ids[0], original=await getToolingJob(jobId), old=original.usages.find(u=>u.position==='UPPER_OUTER')!;
      await cmd(jobId,'SWAP',{position:'UPPER_OUTER',bladeId:blades[1].id,disposition:'HOME'});
      const current=await getToolingJob(jobId);assert.equal(current.usages.length,5);assert.equal(current.usages.filter(u=>u.isCurrent).length,4);
      assert.equal((await prisma.toolingStock.findUniqueOrThrow({where:{id:old.stockId!}})).state,'AVAILABLE');
      await prisma.terminalToolingBlade.update({where:{id:blades[0].id},data:{model:'改名后的刀片'}});
      assert.equal((current.usages.find(u=>u.id===old.id)!.snapshot as {model:string}).model,'03301220022');
      const p=await cmd(jobId,'PAUSE',{reason:'等料'});assert.ok(p.jobId);await cmd(jobId,'RESUME');
    });
    await t.test('finish retains device stock; exact work duration enters shared hours once',async()=>{
      const id=ids[0], before=await getToolingJob(id), start=new Date(Date.now()-65000);
      await prisma.toolingSegment.deleteMany({where:{jobId:id}});await prisma.toolingSegment.create({data:{jobId:id,kind:'WORK',startedAt:start}});await prisma.toolingJob.update({where:{id},data:{startedAt:start}});
      const payload={key:randomUUID(),action:'FINISH',jobId:id,version:before.version,result:'COMPLETED',dispositions:before.usages.filter(u=>u.isCurrent).map(u=>({usageId:u.id,disposition:u.stockId?'DEVICE':'HOME'}))};
      const a=actors.find(a=>a.id===before.actorId)!;await Promise.all([worklogCommand(a,payload),worklogCommand(a,payload)]);
      const job=await getToolingJob(id);assert.equal(job.activeEmployee,null);assert.equal(job.ledger.length,1);assert.equal(job.ledger[0].reportedMilliseconds,job.workMs);assert.equal(await prisma.toolingStock.count({where:{inUseJobId:id}}),3);
      const day=shanghaiDay(start),range=employeeReportRange('custom',day,day,day);const report=(await loadEmployeeHoursReport({...range,period:'custom',employeeIdConstraint:job.employeeId})).report;
      assert.equal(report.summary.otherWorkMilliseconds,job.workMs);
      const row=await prisma.toolingStock.findFirstOrThrow({where:{inUseJobId:id}});await inv('RETURN',{units:[{id:row.id,version:row.version}],box:4});
      const returned=await prisma.toolingStock.findUniqueOrThrow({where:{id:row.id}});assert.equal(returned.currentBox,4);assert.equal(returned.homeBox,3);
    });
    await t.test('cross-day correction preserves original audit and voids old hours',async()=>{
      const id=ids[0],yesterday=new Date(Date.now()-2*86400000),day=shanghaiDay(yesterday),next=shanghaiDay(Date.now()-86400000);
      await cmd(id,'CORRECT',{reason:'忘记结束，按实际时间核对',segments:[{startedAt:day+'T23:50:00+08:00',endedAt:next+'T00:10:00+08:00'}]});
      const job=await getToolingJob(id);assert.equal(job.workMs,1200000);assert.equal(job.ledger.filter(l=>l.status!=='VOIDED').length,2);assert.ok(job.events.some(e=>e.action==='CORRECT'&&e.detail));
      assert.equal(job.ledger.filter(l=>l.status!=='VOIDED').reduce((s,l)=>s+(l.reportedMilliseconds||0),0),1200000);
      await cmd(id,'SAVE_RECIPE');assert.ok((await getToolingJob(id)).events.some(e=>e.action==='SAVE_RECIPE'));
    });
    await t.test('assistance, overlap prevention and grouped statistics use the same time facts',async()=>{
      const now=new Date(),end=new Date(+now-100000),start=new Date(+end-90000);const result=await worklogCommand(actors[0],{key:randomUUID(),action:'BACKFILL',kind:'ASSIST',category:'刀片整理',description:'整理盒子与散刀',reason:'补报刚才的协助',startedAt:start.toISOString(),endedAt:end.toISOString()});ids.push(String(result.jobId));
      const job=await getToolingJob(String(result.jobId));assert.equal(job.workMs,90000);
      await assert.rejects(worklogCommand(actors[0],{key:randomUUID(),action:'BACKFILL',kind:'ASSIST',category:'刀片整理',description:'重复时段',reason:'测试',startedAt:start.toISOString(),endedAt:end.toISOString()}),/重复报工/);
      const stats=await listToolingWork(actors[0],new URLSearchParams({period:'month',date:shanghaiDay(now),mine:'1'}));assert.equal(stats.summary.assistMs,90000);
      await assert.rejects(worklogCommand({...actors[0],employeeId:null},{key:randomUUID(),action:'START',specification:'新端子'}),/绑定员工/);
    });
    await t.test('loose blades can be assembled, moved, disassembled and retired without double counting',async()=>{
      for(const position of TOOLING_POSITIONS)await inv('ADD',{bladeId:blades[1].id,kind:'LOOSE',position,box:100});
      let units=await prisma.toolingStock.findMany({where:{bladeId:blades[1].id}});
      const selection=()=>units.map(u=>({id:u.id,version:u.version}));
      await inv('ASSEMBLE',{units:selection()});
      let summary=(await getToolingInventory()).find(b=>b.id===blades[1].id)!.stock;
      assert.equal(summary.total,4);assert.equal(summary.completeKits,1);assert.equal(summary.loose,0);
      await assert.rejects(inv('MOVE',{units:selection(),box:1}),/库存已变化/);
      units=await prisma.toolingStock.findMany({where:{bladeId:blades[1].id}});
      await inv('MOVE',{units:selection(),box:99});
      units=await prisma.toolingStock.findMany({where:{bladeId:blades[1].id}});
      assert.ok(units.every(u=>u.currentBox===99&&u.homeBox===99),'moving changes the permanent home; a temporary return does not');
      await inv('DISASSEMBLE',{units:selection()});
      units=await prisma.toolingStock.findMany({where:{bladeId:blades[1].id}});
      await inv('RETIRE',{units:[{id:units[0].id,version:units[0].version}],reason:'实物损坏停用'});
      summary=(await getToolingInventory()).find(b=>b.id===blades[1].id)!.stock;
      assert.equal(summary.total,3);assert.equal(summary.completeKits,0);assert.equal(summary.loose,3);
      await assert.rejects(inv('ADD',{bladeId:blades[1].id,kind:'LOOSE',position:'UPPER_OUTER',box:101}),/1–100/);
    });
  }finally{
    const actorIds=actors.map(a=>a.id),employeeIds=employees.map(e=>e.id), bladeIds=blades.map(b=>b.id), jobs=await prisma.toolingJob.findMany({where:{actorId:{in:actorIds}},select:{id:true}}),jobIds=jobs.map(j=>j.id);
    await prisma.otherWorkTimeRequest.updateMany({where:{toolingJobId:{in:jobIds}},data:{correctionOfId:null}});await prisma.otherWorkTimeRequest.deleteMany({where:{toolingJobId:{in:jobIds}}});await prisma.toolingEvent.deleteMany({where:{actorId:{in:actorIds}}});await prisma.toolingReceipt.deleteMany({where:{actorId:{in:actorIds}}});await prisma.toolingUsage.deleteMany({where:{jobId:{in:jobIds}}});await prisma.toolingStock.deleteMany({where:{bladeId:{in:bladeIds}}});await prisma.toolingSegment.deleteMany({where:{jobId:{in:jobIds}}});await prisma.toolingJob.deleteMany({where:{id:{in:jobIds}}});const terminals=await prisma.terminalToolingTerminal.findMany({where:{specification:{startsWith:prefix}},select:{id:true}});await prisma.terminalToolingSetup.deleteMany({where:{terminalId:{in:terminals.map(x=>x.id)}}});await prisma.terminalToolingTerminal.deleteMany({where:{id:{in:terminals.map(x=>x.id)}}});await prisma.terminalToolingBlade.deleteMany({where:{id:{in:bladeIds}}});await prisma.user.deleteMany({where:{id:{in:actorIds}}});await prisma.employee.deleteMany({where:{id:{in:employeeIds}}});
  }
});
