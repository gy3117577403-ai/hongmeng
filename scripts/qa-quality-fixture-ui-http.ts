import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { prisma } from '../lib/prisma';

async function main() {
  const base = process.env.QUALITY_FIXTURE_QA_BASE || '';
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '5544');
  assert.equal(url.pathname, '/quality_fixture_revision_ui');
  assert.ok(/^http:\/\/127\.0\.0\.1:32\d{2}$/.test(base));
  const tag = 'UI199-' + randomUUID().slice(0, 6), customer = '周筛选验收 ' + tag;
  const ids = Array.from({length:205},()=>randomUUID()), orders=ids.map(()=>randomUUID());
  const oldId = randomUUID();
  await prisma.drawingLibraryItem.createMany({data:[...ids.map((id,i)=>({id,customerName:customer,specification:tag+'-'+String(i).padStart(3,'0'),libraryKey:tag+'-'+i})),{id:oldId,customerName:customer,specification:tag+'-OLD',libraryKey:tag+'-old'}]});
  await prisma.productionPlanOrder.createMany({data:[...ids,oldId].map((id,i)=>({id:orders[i] || oldId,sourceOrderNo:tag+'-'+i,sourceLineNo:1,customerName:customer,productName:'周筛选测试组件',specification:tag+'-'+i,drawingLibraryItemId:id,orderQuantity:2,orderDate:new Date('2026-08-01'),customerDueDate:new Date('2026-10-01')}))});
  const monday = new Date('2026-09-21T00:00:00+08:00'), sunday=new Date('2026-09-27T00:00:00+08:00');
  await prisma.productionPlanBatch.createMany({data:[...orders.map(planOrderId=>({planOrderId,batchNo:1,quantity:1,weekStartDate:monday,weekEndDate:sunday,plannedCompletionDate:sunday})),{planOrderId:orders[0],batchNo:2,quantity:1,weekStartDate:monday,weekEndDate:sunday,plannedCompletionDate:sunday},{planOrderId:oldId,batchNo:1,quantity:1,weekStartDate:new Date('2026-09-14T00:00:00+08:00'),weekEndDate:new Date('2026-09-20T00:00:00+08:00'),plannedCompletionDate:new Date('2026-09-20T00:00:00+08:00')}]});
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qf-plan',password:'FixtureLocal619!'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];assert.ok(cookie);
  const headers={Cookie:cookie!};
  const all:any[]=[];let offset=0,pages=0;
  do {
    const r=await fetch(base+'/api/drawing-library?'+new URLSearchParams({week:'2026-09-21',keyword:tag,paged:'true',offset:String(offset),itemId:oldId}),{headers});
    assert.equal(r.status,200);const j=await r.json();all.push(...j.items);pages++;
    if(!j.hasMore) break;offset=j.nextOffset;
  } while(pages<10);
  assert.equal(pages,2);assert.equal(all.length,205);assert.equal(new Set(all.map(p=>p.id)).size,205);assert.ok(!all.some(p=>p.id===oldId));
  assert.ok(all.every(p=>p.fileCount===0));assert.equal(all.find(p=>p.id===ids[0]).planBatchCount,2);
  const old=await fetch(base+'/api/drawing-library?'+new URLSearchParams({week:'2026-09-14',keyword:tag,paged:'true'}),{headers}).then(r=>r.json());assert.deepEqual(old.items.map((p:any)=>p.id),[oldId]);
  const empty=await fetch(base+'/api/drawing-library?'+new URLSearchParams({week:'2026-09-28',keyword:tag,paged:'true',itemId:ids[0]}),{headers}).then(r=>r.json());assert.equal(empty.items.length,0);
  const invalid=await fetch(base+'/api/drawing-library?week=2026-02-30',{headers});assert.equal(invalid.status,400);
  const anonymous=await fetch(base+'/api/drawing-library?week=2026-09-21');assert.equal(anonymous.status,401);
  const result={ok:true,base,tag,customer,productCount:all.length,pages,uniqueProducts:true,emptyDocumentsIncluded:true,outOfWeekSelectionExcluded:true,duplicateBatches:2,invalidDateRejected:true,loginRequired:true,firstProduct:ids[0]};
  writeFileSync('output/quality-fixture-qa/ui199-http.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
