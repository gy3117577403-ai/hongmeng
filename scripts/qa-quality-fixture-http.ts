import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';

async function main() {
  const base = process.env.QUALITY_FIXTURE_QA_BASE || 'http://127.0.0.1:3214';
  assert.equal(new URL(base).hostname, '127.0.0.1');
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.includes('quality_fixture'));
  assert.equal(process.env.QUALITY_FIXTURE_QA_ALLOW, 'disposable-fixture-runtime');
  const fixture = JSON.parse(await readFile('output/quality-fixture-qa/fixture.json','utf8'));
  const login = await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'qf-buyer',password:process.env.QUALITY_FIXTURE_QA_PASSWORD || 'FixtureLocal619!'})});
  assert.equal(login.status,200); const cookie=login.headers.get('set-cookie')!.match(/hm_session=[^;]+/)![0];
  async function request(path:string,body?:object,status=200) {
    const r=await fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{Cookie:cookie,Origin:base,...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}: {})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json(); assert.equal(r.status,status,JSON.stringify(data)); return data.data;
  }
  assert.equal((await fetch(base+'/api/quality-fixtures')).status,401);
  const pkg=await prisma.qfPackage.findFirstOrThrow({where:{libraryItemId:fixture.productId,status:'APPROVED'}});
  const print=await request('/api/work-order-qr/prints',{workOrderIds:[fixture.workOrderId],mode:'CUSTOM',materials:['TRAVELER','DRAWING'],copies:1});
  const printId=print.printIds[0];
  const doc=await fetch(base+'/api/work-order-qr/prints/'+printId+'/drawing',{headers:{Cookie:cookie}});
  assert.equal(doc.status,200); const bytes=Buffer.from(await doc.arrayBuffer()); assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);
  await writeFile('output/quality-fixture-qa/approved-drawing-print.pdf',bytes);
  const line=await prisma.pcLine.findFirstOrThrow({where:{fixturePackageId:pkg.id,spec:'DT-MATE-01'},orderBy:{createdAt:'desc'}});
  const entry=async()=>{const l=await prisma.pcLine.findUniqueOrThrow({where:{id:line.id}});return {id:l.id,version:l.version};};
  const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  if(line.status==='PENDING') await request('/api/purchases',{action:'APPROVE_LINES',entries:[await entry()]});
  if(['PENDING','APPROVED'].includes(line.status)) await request('/api/purchases',{action:'PURCHASE',entries:[{...await entry(),actualCents:70000}],contractNumber:'QA-FIXTURE-240919',settlement:'CORPORATE',supplier:'本地验收供应商',payee:'本地验收供应商',bank:'验收银行',account:'QA-ONLY',eta:date});
  const current=await prisma.pcLine.findUniqueOrThrow({where:{id:line.id}});
  if(current.receivedQty<7) await request('/api/purchases',{action:'RECEIVE',entries:[{...await entry(),quantity:7-current.receivedQty}],date,warehouse:'治具库',location:'UI-A01',accepted:true,fixtureDisposition:'AVAILABLE',fitConfirmed:true,continuityConfirmed:true,acceptanceNote:'独立测试：型号、数量、对插与导通全部通过'});
  const qf=await request('/api/quality-fixtures?product='+fixture.productId);
  assert.equal(qf.readiness.groups[0].available,7); assert.equal(qf.readiness.groups[0].shortage,0);
  const normal=await request('/api/purchases?source=NORMAL&q=DT-MATE-01'); assert.equal(normal.total,0);
  const special=await request('/api/purchases?source=FIXTURE&q=DT-MATE-01'); assert.equal(special.total,1);
  const exportResponse=await fetch(base+'/api/purchases/export?source=FIXTURE&q=DT-MATE-01',{headers:{Cookie:cookie}}); assert.equal(exportResponse.status,200);
  const workbook=new ExcelJS.Workbook(); const exportBytes=Buffer.from(await exportResponse.arrayBuffer()); await workbook.xlsx.load(exportBytes as never); assert.equal(workbook.worksheets[0].rowCount,2);
  await writeFile('output/quality-fixture-qa/fixture-purchases.xlsx',exportBytes);
  const result={ok:true,printUrl:base+print.url,printId,packageId:pkg.id,fixtureAvailable:7,normalRecords:normal.total,fixtureRecords:special.total,actualPdfBytes:bytes.length,actualExcelRows:workbook.worksheets[0].rowCount};
  await writeFile('output/quality-fixture-qa/http-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().finally(()=>prisma.$disconnect());
