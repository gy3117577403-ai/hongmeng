import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';

const base=(process.env.QUALITY_DATA_QA_BASE||'http://127.0.0.1:33124').replace(/\/$/,'');
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'loopback-only acceptance');
assert.equal(process.env.QUALITY_DATA_QA_ALLOW,'disposable-quality-runtime');
const fixture=JSON.parse((await fs.readFile(process.env.QUALITY_DATA_QA_FIXTURE||'tmp/quality-runtime/fixture-v124.json','utf8')).replace(/^\uFEFF/,''));
let cookie='';const checks=[];
async function request(path,method='GET',data,expected=200){
  const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}:{}),...(data&&!(data instanceof FormData)?{'Content-Type':'application/json'}:{})},body:data?data instanceof FormData?data:JSON.stringify(data):undefined,redirect:'manual',signal:AbortSignal.timeout(90000)});
  const bytes=Buffer.from(await response.arrayBuffer());const body=response.headers.get('content-type')?.includes('json')?JSON.parse(bytes.toString()):bytes;
  assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${Buffer.isBuffer(body)?body.toString().slice(0,120):JSON.stringify(body).slice(0,500)}`);
  return {response,body};
}
await request('/api/planning/import/template','GET',undefined,401);
const login=await request('/api/auth/login','POST',{username:fixture.users.admin.username,password:fixture.password});
cookie=login.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];assert.ok(cookie);
const template=(await request('/api/planning/import/template')).body;
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template);const sheet=workbook.worksheets[0];
const headers=sheet.getRow(4).values.slice(1);
assert.equal(headers.length,13);assert.equal(headers.filter(v=>v.endsWith('*')).length,7);
assert.ok(!headers.some(v=>/来源订单|订单行号/.test(v)));assert.equal(headers[6],'单件计划工时（分钟）');assert.equal(sheet.getCell('G5').dataValidation.allowBlank,true);
checks.push('downloaded XLSX has 13 columns, seven required fields and optional minute time');
const prefix=`QA-IMPORT-124-${randomUUID().slice(0,8)}`;
const date=days=>new Date(Date.now()+days*86400000+8*3600000).toISOString().slice(0,10);
async function preview(rows,week=date(14),old=false){
  const book=new ExcelJS.Workbook(),tab=book.addWorksheet('计划');
  tab.addRow(old?['来源订单号*','订单行号*',...headers]:headers);rows.forEach(row=>tab.addRow(row));
  const file=Buffer.from(await book.xlsx.writeBuffer()),form=new FormData();form.set('file',new File([file],'计划验收.xlsx'));form.set('weekStartDate',week);
  return {file,body:(await request('/api/planning/import/preview','POST',form)).body};
}
const row=(spec,time,quantity=40)=>[date(0),prefix,'验收线束',spec,100,quantity,time,date(70),'','','','',''];
const uploaded=await preview([row(prefix,2.125),row(`${prefix}-EMPTY`,'')]);
assert.equal(uploaded.body.summary.invalidCount,0);assert.equal(uploaded.body.rows[0].timePreview.unitMilliseconds,127500);assert.equal(uploaded.body.rows[0].timePreview.totalMilliseconds,'5100000');assert.equal(uploaded.body.rows[1].timePreview.source,'missing');
async function commit(preview,orders={},expected=200){return (await request('/api/planning/import/commit','POST',{batchId:preview.batchId,previewToken:preview.previewToken,orderDecisions:orders},expected)).body;}
const committed=await commit(uploaded.body);assert.equal(committed.summary.created,2);assert.deepEqual(await commit(uploaded.body),committed);
const orders=(await request('/api/planning/orders?keyword='+encodeURIComponent(prefix))).body.orders;
const order=orders.find(order=>order.specification===prefix);assert.ok(order);
assert.equal(order.planningUnitMilliseconds,127500);assert.equal(order.batches[0].unitMillisecondsSnapshot,127500);assert.equal(order.batches[0].totalMillisecondsSnapshot,'5100000');
const repeatForm=new FormData();repeatForm.set('file',new File([uploaded.file],'同文件.xlsx'));repeatForm.set('weekStartDate',date(14));
const repeated=(await request('/api/planning/import/preview','POST',repeatForm)).body;assert.equal(repeated.summary.duplicateCount,2);
assert.equal((await commit(repeated)).summary.created,0);checks.push('new template commits, missing time remains unknown, repeated request and file do not duplicate batches');
const more=await preview([row(prefix,'',30)],date(21));const candidate=more.body.rows[0].orderCandidates[0];assert.ok(candidate);assert.equal(candidate.remainingQuantity,60);assert.equal(candidate.planningUnitMilliseconds,127500);
await commit(more.body,{},409);assert.equal((await commit(more.body,{'2':candidate.id})).summary.created,1);
checks.push('cross-week association requires an explicit choice and adopts original order time');
const overflow=await preview([row(prefix,'',40)],date(28));await commit(overflow.body,{'2':candidate.id},409);
checks.push('cross-week quantities cannot exceed original unallocated order quantity');
const old=await preview([[`${prefix}-LEGACY`,1,...row(`${prefix}-LEGACY`,1.5)]],date(14),true);assert.equal(old.body.summary.invalidCount,0);assert.equal((await commit(old.body)).summary.created,1);
checks.push('legacy source-order and line-number columns remain compatible');
const invalid=await preview([row(`${prefix}-INVALID`,0)]);assert.equal(invalid.body.summary.invalidCount,1);await commit(invalid.body,{},409);
checks.push('invalid supplied time is blocked at preview and commit');
if(process.env.PLANNING_IMPORT_QA_REFERENCE){
  const reference=JSON.parse((await fs.readFile(process.env.PLANNING_IMPORT_QA_REFERENCE,'utf8')).replace(/^\uFEFF/,''));
  const makeReferenceRow=time=>{const value=row(reference.specification,time,20);value[1]=reference.customerName;return value;};
  const referencePreview=await preview([makeReferenceRow(''),makeReferenceRow(2.125)],date(14));
  assert.equal(referencePreview.body.rows[0].timePreview.source,'published');assert.equal(referencePreview.body.rows[0].timePreview.unitMilliseconds,60000);
  assert.equal(referencePreview.body.rows[1].timePreview.source,'import');assert.equal((await commit(referencePreview.body)).summary.created,2);
  const saved=(await request('/api/planning/orders?keyword='+encodeURIComponent(reference.specification))).body.orders;
  assert.deepEqual(saved.flatMap(order=>order.batches.map(batch=>batch.unitMillisecondsSnapshot)).sort((a,b)=>a-b),[60000,127500]);
  const normalized=makeReferenceRow('');normalized[3]='  '+reference.specification.toLowerCase()+'  ';
  const check=await preview([normalized],date(28));assert.equal(check.body.rows[0].timePreview.unitMilliseconds,60000);assert.equal(check.body.rows[0].matchedDrawingLibraryItemId,reference.id);
  checks.push('published product time is reused, explicit time overrides only the new batch, and normalized product identity reuses the same archive');
}
const output=process.env.PLANNING_IMPORT_QA_OUTPUT||'output/playwright/planning-import-runtime-v124.json';
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify({base,prefix,checks,passed:checks.length,templateHeaders:headers,committed},null,2));
console.log(JSON.stringify({passed:checks.length,checks,output}));
