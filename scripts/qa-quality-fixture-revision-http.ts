import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';

async function main() {
  const base = process.env.QUALITY_FIXTURE_QA_BASE || 'http://127.0.0.1:3220';
  assert.equal(new URL(base).hostname, '127.0.0.1');
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /quality_fixture/);
  assert.equal(process.env.QUALITY_FIXTURE_QA_ALLOW, 'disposable-fixture-runtime');
  const fixture = JSON.parse(await readFile('output/quality-fixture-qa/fixture.json', 'utf8'));
  for (const [code,name] of [['drawing','图纸'],['sop','SOP']]) await prisma.resourceCategory.upsert({where:{code},update:{},create:{code,name,sortOrder:0}});
  const cookies: Record<string,string> = {};
  for (const role of ['plan', 'supervisor', 'quality', 'buyer']) {
    const r = await fetch(base+'/api/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json', Origin:base }, body:JSON.stringify({ username:'qf-'+role, password:process.env.QUALITY_FIXTURE_QA_PASSWORD || 'FixtureLocal619!' }) });
    assert.equal(r.status,200,await r.text()); cookies[role] = r.headers.get('set-cookie')!.match(/hm_session=[^;]+/)![0];
  }
  async function api(path:string, body?:object, role='plan', expected=200) {
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookies[role],Origin:base,...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}: {})},...(body?{body:JSON.stringify(body)}:{})});
    const j=await r.json(); assert.equal(r.status,expected,JSON.stringify(j)); return j.data;
  }
  const command=(body:object,role='plan',expected=200)=>api('/api/quality-fixtures',body,role,expected);
  const latest=()=>prisma.qfPackage.findFirstOrThrow({where:{libraryItemId:fixture.productId},orderBy:{sequence:'desc'}});
  const upload=async(kind:string,name:string,packageId='')=>{
    const form=new FormData(); const bytes=await readFile('output/quality-fixture-qa/'+name);
    form.set('file',new Blob([bytes],{type:name.endsWith('pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),kind==='sop'?'acceptance-sop.pdf':name);
    form.set('kind',kind);form.set('product',fixture.productId);form.set('package',packageId);
    const r=await fetch(base+'/api/quality-fixtures/files',{method:'POST',headers:{Cookie:cookies.plan,Origin:base},body:form}); const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j.data;
  };
  assert.equal((await fetch(base+'/api/quality-fixtures')).status,401);
  await command({action:'SET_REQUIREMENT',productIds:[fixture.productId],needFixture:true});
  const drawing=await upload('drawing','acceptance-drawing.pdf'); const sop=await upload('sop','acceptance-drawing.pdf');
  await command({action:'SYNC_DOCUMENTS'});
  let p=await latest(); assert.equal(p.status,'DRAFT');
  const bom=await upload('bom','acceptance-bom.xlsx',p.id);
  const rows=await command({action:'SCAN_BOM',id:bom.id,mapping:bom.mapping});
  assert.equal(rows.filter((r:any)=>r.include).length,2);
  p=await latest();
  await command({action:'SAVE_PACKAGE',id:p.id,version:p.version,libraryItemId:fixture.productId,revision:'A',needFixture:true,drawingFileIds:[drawing.id],sopFileIds:[sop.id],bomFileId:bom.id,bomMapping:bom.mapping,bomRows:rows,bomConfirmed:true,parallelCount:2,spareCount:1});
  p=await latest(); await command({action:'SUBMIT',id:p.id,version:p.version});
  const printBody={workOrderIds:[fixture.workOrderId],mode:'CUSTOM',materials:['TRAVELER','DRAWING','SOP'],copies:1};
  await api('/api/work-order-qr/prints',printBody,'plan',409);
  p=await latest(); await command({action:'APPROVE',id:p.id,version:p.version,confirmed:true},'quality',403);
  await command({action:'APPROVE',id:p.id,version:p.version,confirmed:true},'supervisor');
  await api('/api/work-order-qr/prints',printBody,'plan',409);
  p=await latest(); await command({action:'APPROVE',id:p.id,version:p.version,confirmed:true},'quality');
  const unmatched=await api('/api/quality-fixtures?product='+fixture.productId);assert.equal(unmatched.readiness.unmatched,2);
  const print=await api('/api/work-order-qr/prints',printBody);
  const pdfs:Record<string,number>={};
  for (const kind of ['drawing','sop']) {
    const r=await fetch(base+'/api/work-order-qr/prints/'+print.printIds[0]+'/'+kind,{headers:{Cookie:cookies.plan}});assert.equal(r.status,200,await r.clone().text());const bytes=Buffer.from(await r.arrayBuffer());
    pdfs[kind]=(await PDFDocument.load(bytes)).getPageCount(); assert.ok(pdfs[kind]>0);await writeFile('output/quality-fixture-qa/revision-printed-'+kind+'.pdf',bytes);
  }
  const m=await command({action:'SAVE_MAPPING',connectorModel:'DT-C01',model:'DT-MATE-01'});
  await command({action:'SAVE_MAPPING',connectorModel:'DT-C02',fixtureId:m.fixtureId});
  p=await latest(); const demand=await api('/api/quality-fixtures?product='+fixture.productId); assert.equal(demand.readiness.groups[0].shortage,7);
  await command({action:'CREATE_FIXTURE_PURCHASE',packageId:p.id,fixtureId:m.fixtureId,quantity:7,estimateCents:70000,needDate:'2026-09-21',urgency:'NORMAL',reason:'本地独立验收：补齐导通治具'});
  const line=await prisma.pcLine.findFirstOrThrow({where:{fixturePackageId:p.id,fixtureId:m.fixtureId},orderBy:{createdAt:'desc'}});
  const entry=async()=>{const l=await prisma.pcLine.findUniqueOrThrow({where:{id:line.id}});return {id:l.id,version:l.version};};
  await api('/api/purchases',{action:'APPROVE_LINES',entries:[await entry()]},'buyer');
  await api('/api/purchases',{action:'PURCHASE',entries:[{...await entry(),actualCents:70000}],contractNumber:'QA-REVISION',settlement:'CORPORATE',supplier:'本地验收供应商',payee:'本地验收供应商',bank:'验收银行',account:'QA-ONLY',eta:'2026-09-21'},'buyer');
  for(const quantity of [3,4]) await api('/api/purchases',{action:'RECEIVE',entries:[{...await entry(),quantity}],date:'2026-09-19',warehouse:'治具库',location:'UI-A01',accepted:true,fixtureDisposition:'AVAILABLE',fitConfirmed:true,continuityConfirmed:true,acceptanceNote:'本地验收：对插与导通确认'},'buyer');
  const complete=await api('/api/quality-fixtures?product='+fixture.productId);assert.equal(complete.readiness.groups[0].available,7);assert.equal(complete.readiness.groups[0].shortage,0);
  assert.equal((await api('/api/purchases?source=NORMAL&q=DT-MATE-01')).total,0);
  assert.equal((await api('/api/purchases?source=FIXTURE&q=DT-MATE-01')).total,1);
  const result={ok:true,base,packageId:p.id,printId:print.printIds[0],unmatchedPrintAllowed:true,pdfs,partialReceipts:[3,4],available:7,shortage:0,twoLevelPrintGate:true,sourceIsolation:true};
  await writeFile('output/quality-fixture-qa/revision-http-result.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
}
main().finally(()=>prisma.$disconnect());
