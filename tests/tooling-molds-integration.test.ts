import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { inventoryCommand, worklogCommand, getToolingJob, getToolingReferences, getToolingInventory, listToolingWork } from '../lib/tooling-worklog-service';
import { shanghaiDay } from '../lib/tooling-worklog-domain';

test('dedicated molds, combinations and historical work preserve stock and exact hours', {skip:process.env.RUN_DB_INTEGRATION!=='1'}, async t=>{
  const url=new URL(process.env.DATABASE_URL||'');assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&['/tooling250','/hongmeng_ci'].includes(url.pathname),'isolated test database only');
  const prefix='MOLD-IT-'+randomUUID().slice(0,8);
  const employees=await Promise.all([1,2].map(n=>prisma.employee.create({data:{employeeNo:prefix+n,name:prefix+n,department:'生产部',team:'调模组'}})));
  const actors=await Promise.all(employees.map(e=>prisma.user.create({data:{employeeId:e.id,username:e.employeeNo,displayName:e.name,passwordHash:'integration-only',laborRole:'EMPLOYEE'}})));
  const blade=await prisma.terminalToolingBlade.create({data:{model:prefix+'-B',normalizedKey:prefix+'-B',compatiblePositions:['UPPER_INNER'],positionSpecs:{create:{position:'UPPER_INNER',specification:'4.2×2.2'}}}});
  const inv=(action:string,extra:Record<string,unknown>={})=>inventoryCommand(actors[0],{key:randomUUID(),action,...extra});
  const start=(index:number,extra:Record<string,unknown>={})=>worklogCommand(actors[index],{key:randomUUID(),action:'START',kind:'TUNING',specification:prefix,toolingMode:'MOLD',moldId,...extra});
  const finish=async(id:string,extra:Record<string,unknown>={})=>{const j=await getToolingJob(id);return worklogCommand(actors.find(a=>a.id===j.actorId)!,{key:randomUUID(),action:'FINISH',jobId:id,version:j.version,result:'COMPLETED',moldDisposition:'HOME',moldRestored:true,dispositions:j.usages.filter(u=>u.isCurrent).map(u=>({usageId:u.id,disposition:'HOME'})),...extra});};
  let moldId='',stockId='';
  try{
    await t.test('one physical mold per normalized model, positions 1–20, no blade required',async()=>{
      await assert.rejects(inv('MOLD_CREATE',{model:prefix,position:21}),/1–20/);
      moldId=String((await inv('MOLD_CREATE',{model:prefix,position:8})).moldId);
      await assert.rejects(inv('MOLD_CREATE',{model:' '+prefix.toLowerCase()+' ',position:9}),/已建档/);
      assert.equal((await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}})).state,'AVAILABLE');
      await inv('REGISTER',{bladeId:blade.id,kind:'LOOSE',position:'UPPER_INNER',quantity:1,box:2});
      stockId=(await prisma.toolingStock.findFirstOrThrow({where:{bladeId:blade.id}})).id;
    });
    await t.test('concurrent mold claims have one winner; completion appears in terminal history without any blades',async()=>{
      const results=await Promise.allSettled([start(0),start(1)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const id=String((results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Record<string,unknown>>).value.jobId);
      const job=await getToolingJob(id);assert.equal(job.usages.length,0);assert.equal(job.moldUsage?.moldId,moldId);
      const held=await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}});
      await assert.rejects(inv('MOLD_RETURN',{moldId,version:held.version,position:8,restored:true}),/先结束作业/);
      await finish(id);assert.equal((await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}})).state,'AVAILABLE');
      assert.ok((await getToolingReferences(job.terminalId!)).some(j=>j.id===id));
    });
    await t.test('combination occupies one mold and only borrowed blade; unrestored mold cannot be issued',async()=>{
      await assert.rejects(start(0,{toolingMode:'COMBINATION',choices:[]}),/至少选择/);
      await assert.rejects(start(0,{choices:[{position:'UPPER_INNER',bladeId:blade.id,stockId}]}),/组合调模/);
      const id=String((await start(0,{toolingMode:'COMBINATION',choices:[{position:'UPPER_INNER',bladeId:blade.id,stockId}]})).jobId);
      let b=(await getToolingInventory()).find(b=>b.id===blade.id)!;assert.equal(b.stock.inUse,1);assert.equal(b.stock.availableLoose,0);assert.equal(b.stock.total,1);
      await finish(id,{moldRestored:false});
      const mold=await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}});assert.equal(mold.state,'RESTORE');
      b=(await getToolingInventory()).find(b=>b.id===blade.id)!;assert.equal(b.stock.availableLoose,1);assert.equal(b.stock.total,1);
      await assert.rejects(start(1),/不可用/);
      await assert.rejects(inv('MOLD_RETURN',{moldId,version:mold.version,position:8,restored:false}),/恢复原配/);
      await inv('MOLD_RETURN',{moldId,version:mold.version,position:8,restored:true});
      assert.equal((await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}})).state,'AVAILABLE');
    });
    await t.test('historical combination saves snapshots without changing current claims; retries are idempotent',async()=>{
      const activeId=String((await start(1,{toolingMode:'COMBINATION',choices:[{position:'UPPER_INNER',bladeId:blade.id,stockId}]})).jobId);
      const before=await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}}), stockBefore=await prisma.toolingStock.findUniqueOrThrow({where:{id:stockId}});
      const endedAt=new Date(Date.now()-2*3600000),startedAt=new Date(+endedAt-35*60000);
      const payload={key:randomUUID(),action:'BACKFILL',kind:'TUNING',toolingMode:'COMBINATION',specification:prefix,moldId,choices:[{position:'UPPER_INNER',bladeId:blade.id,stockId}],startedAt:startedAt.toISOString(),endedAt:endedAt.toISOString(),reason:'忘报补录'};
      const first=await worklogCommand(actors[0],payload),again=await worklogCommand(actors[0],payload);assert.deepEqual(first,again);
      const history=await getToolingJob(String(first.jobId));assert.equal(history.workMs,35*60000);assert.equal(history.moldUsage?.disposition,'HISTORICAL');assert.equal(history.usages[0].disposition,'HISTORICAL');assert.equal(history.ledger.filter(l=>l.status!=='VOIDED').length,1);
      assert.deepEqual(await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}}),before);assert.deepEqual(await prisma.toolingStock.findUniqueOrThrow({where:{id:stockId}}),stockBefore);
      await assert.rejects(worklogCommand(actors[0],{...payload,key:randomUUID()}),/重复报工/);
      await finish(activeId);
      const stats=await listToolingWork(actors[0],new URLSearchParams({period:'day',date:shanghaiDay(endedAt),mine:'1',mode:'COMBINATION',source:'BACKFILL'}));
      assert.equal(stats.summary.modes.COMBINATION,35*60000);assert.equal(stats.summary.backfillCount,1);assert.equal(stats.jobs.length,1);
    });
    await t.test('backdated live start rejects future and overlap; valid start holds current stock and continues',async()=>{
      await assert.rejects(start(0,{action:'BACKSTART',startedAt:new Date(Date.now()+60000).toISOString(),reason:'误选'}),/起止时间/);
      await assert.rejects(start(0,{action:'BACKSTART',startedAt:new Date(Date.now()-3*3600000).toISOString(),reason:'重叠'}),/重复报工/);
      // Dedicated test employee has no current/recent facts, avoiding false overlap with previous real-time scenarios.
      const employee=await prisma.employee.create({data:{employeeNo:prefix+'3',name:prefix+'3'}});employees.push(employee);
      const actor=await prisma.user.create({data:{username:employee.employeeNo,displayName:employee.name,employeeId:employee.id,passwordHash:'integration-only'}});actors.push(actor);
      const id=String((await start(2,{action:'BACKSTART',startedAt:new Date(Date.now()-18*60000).toISOString(),reason:'忘记开始'})).jobId);
      const job=await getToolingJob(id);assert.equal(job.recordSource,'BACKSTART');assert.equal(job.status,'RUNNING');assert.ok(job.workMs>=18*60000);
      assert.equal((await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}})).inUseJobId,id);
      await finish(id);assert.equal((await getToolingJob(id)).activeEmployee,null);
    });
    await t.test('completed historical backfill is allowed while another nonoverlapping job is running',async()=>{
      const active=String((await start(0,{toolingMode:'BLADE',moldId:'',choices:[]})).jobId);
      const endedAt=new Date(Date.now()-5*3600000),startedAt=new Date(+endedAt-600000);
      const id=String((await start(0,{action:'BACKFILL',startedAt:startedAt.toISOString(),endedAt:endedAt.toISOString(),reason:'补漏报'})).jobId);
      assert.equal((await getToolingJob(id)).workMs,600000);assert.equal((await getToolingJob(active)).status,'RUNNING');await finish(active);
    });
    await t.test('stale inventory updates and invalid mold selections fail without corrupting facts',async()=>{
      const mold=await prisma.toolingMold.findUniqueOrThrow({where:{id:moldId}});
      await inv('MOLD_MOVE',{moldId,version:mold.version,position:20});
      await assert.rejects(inv('MOLD_MOVE',{moldId,version:mold.version,position:2}),/已变化/);
      await assert.rejects(start(0,{toolingMode:'BLADE'}),/请勿选择专模/);
      await assert.rejects(start(0,{kind:'ASSIST',description:'协助',category:'其他协助'}),/不能占用/);
      const job=await prisma.toolingJob.findFirstOrThrow({where:{moldUsage:{moldId},endedAt:{not:null}}});
      assert.equal(((await getToolingJob(job.id)).moldUsage?.snapshot as {homePosition:number}).homePosition,8,'move preserves historical location');
    });
  }finally{
    const actorIds=actors.map(a=>a.id),jobs=await prisma.toolingJob.findMany({where:{actorId:{in:actorIds}},select:{id:true}}),jobIds=jobs.map(j=>j.id);
    await prisma.otherWorkTimeRequest.updateMany({where:{toolingJobId:{in:jobIds}},data:{correctionOfId:null}});await prisma.otherWorkTimeRequest.deleteMany({where:{toolingJobId:{in:jobIds}}});
    await prisma.toolingMoldUsage.deleteMany({where:{jobId:{in:jobIds}}});await prisma.toolingMold.deleteMany({where:{id:moldId}});await prisma.toolingUsage.deleteMany({where:{jobId:{in:jobIds}}});await prisma.toolingStock.deleteMany({where:{bladeId:blade.id}});
    await prisma.toolingEvent.deleteMany({where:{actorId:{in:actorIds}}});await prisma.toolingReceipt.deleteMany({where:{actorId:{in:actorIds}}});await prisma.toolingJob.deleteMany({where:{id:{in:jobIds}}});
    await prisma.terminalToolingTerminal.deleteMany({where:{specification:prefix}});await prisma.terminalToolingBlade.delete({where:{id:blade.id}});await prisma.user.deleteMany({where:{id:{in:actorIds}}});await prisma.employee.deleteMany({where:{id:{in:employees.map(e=>e.id)}}});
  }
});
