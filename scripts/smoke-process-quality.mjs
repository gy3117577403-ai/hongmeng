import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
const base = process.env.PROCESS_QUALITY_QA_BASE || 'http://127.0.0.1:3000';
assert.equal(process.env.PROCESS_QUALITY_QA_ALLOW, 'disposable-quality-reporting-runtime');
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const fixture = JSON.parse((await fs.readFile(process.env.PROCESS_QUALITY_QA_FIXTURE, 'utf8')).replace(/^\uFEFF/, ''));
const checks = [], cookies = {}, order = fixture.orders[0];
async function call(actor, path, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, { method, headers: { ...(cookies[actor] ? { Cookie: cookies[actor] } : {}), ...(method !== 'GET' ? { Origin: base } : {}),
    ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined, redirect: 'manual', signal: AbortSignal.timeout(90000) });
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  assert.ok([expected].flat().includes(response.status), `${actor} ${method} ${path}: ${response.status} ${text.slice(0, 500)}`);
  checks.push({ actor, path: path.split('?')[0], method, status: response.status });
  return { body, response };
}
await call('none', '/api/process-report-quality?employees=1', 'GET', undefined, 401);
for (const actor of ['admin','operator','other']) {
  const login = await call(actor, '/api/auth/login', 'POST', { username: fixture.users[actor].username, password: fixture.password });
  cookies[actor] = login.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)[0]; assert.ok(cookies[actor]);
}
await call('operator','/api/quality-data/records?period=all','GET',undefined,403);
const employees = (await call('operator', '/api/process-report-quality?employees=1')).body.data;
assert.ok(employees.some(p => p.id === fixture.users.other.employeeId)); assert.ok(!('department' in employees[0]));
const step = n => order.steps.find(s => s.position === n), endpoint = `/api/field-report/tickets/${order.publicCode}/completions`;
let context = (await call('operator',`/api/field-report/tickets/${order.publicCode}?stepId=${step(16).id}`)).body.data.context;
const command = { stepId: step(16).id, processedQty: 20, defectQty: 3, defectDisposition: 'rework', workDate: fixture.workDate,
  employeeIds: [fixture.users.operator.employeeId], expectedUserId: fixture.users.operator.id, expectedRouteVersion: context.routeVersion, idempotencyKey: randomUUID() };
const photo = await sharp({ create: { width: 48, height: 36, channels: 3, background: '#e87727' } }).png().toBuffer();
const form = new FormData(); form.set('file',new Blob([photo],{type:'image/png'}),'现场验收.png'); form.set('routeId',order.routeId);form.set('stepId',step(16).id);form.set('idempotencyKey',randomUUID());
const file = (await call('operator','/api/process-report-quality','POST',form)).body.data;
await call('other','/api/process-report-quality?id='+file.id,'GET',undefined,404);
const quality = { responsibility: { status: 'PENDING', allocations: [] }, issue: '断路', note: '导通机工位检查', evidenceIds: [file.id] };
const result = (await call('operator',endpoint,'POST',{...command,qualityReport:quality})).body.data;
assert.ok(result.completionId);
assert.equal((await call('operator',endpoint,'POST',{...command,qualityReport:quality})).body.data.completionId,result.completionId);
await call('operator',endpoint,'POST',{...command,qualityReport:{...quality,note:'changed'}},409);
let records = (await call('admin',`/api/quality-data/records?period=all&workOrderId=${order.id}&source=report&type=CONTINUITY`)).body.data;
assert.equal(records.total,1); let record=records.items[0];
assert.equal(record.sourceCompletionId,result.completionId);assert.equal(record.data.context.inspectionQty,'20');assert.equal(record.data.context.defectQty,'3');
assert.equal(record.reportSnapshot.goodQty,17);assert.equal(record.responsibilityStatus,'PENDING');assert.equal(record.attachments.length,1);
assert.equal((await call('admin',`/api/quality-data/records?period=all&workOrderId=${order.id}&responsibility=PENDING`)).body.data.total,1);
await call('admin','/api/quality-data/records/'+record.id,'PATCH',{action:'SAVE',version:record.version,reason:'改源数量'},409);
await call('admin','/api/quality-data/records/'+record.id,'DELETE',{action:'DELETE',version:record.version,reason:'删除源记录'},409);
const responsibility={status:'ASSIGNED',allocations:[{employeeId:fixture.users.other.employeeId,quantity:3}]};
record=(await call('admin','/api/quality-data/records/'+record.id,'PATCH',{action:'UPDATE_REPORT_DETAILS',version:record.version,reason:'现场核实责任',qualityReport:{...quality,evidenceIds:[],responsibility}})).body.data;
assert.equal(record.responsibility.allocations[0].name,fixture.users.other.name);assert.equal(record.reportSnapshot.quantity,20);
context=(await call('operator',`/api/field-report/tickets/${order.publicCode}?stepId=${step(8).id}`)).body.data.context;
await call('operator',endpoint,'POST',{...command,stepId:step(8).id,expectedRouteVersion:context.routeVersion,idempotencyKey:randomUUID(),qualityReport:{...quality,responsibility:{status:'ASSIGNED',allocations:[{employeeId:fixture.users.other.employeeId,quantity:2}]},evidenceIds:[]}},400);
let batch=(await call('operator',endpoint,'POST',{...command,expectedRouteVersion:context.routeVersion,idempotencyKey:randomUUID(),items:[
 {stepId:step(32).id,processedQty:8,defectQty:0,qualityReport:{responsibility:{status:'PENDING',allocations:[]},note:'',issue:'',evidenceIds:[]}},
 {stepId:step(35).id,processedQty:8,defectQty:0,qualityReport:{responsibility:{status:'PENDING',allocations:[]},note:'',issue:'',evidenceIds:[]}},
]})).body.data;
assert.equal(batch.completionCount,2);
records=(await call('admin',`/api/quality-data/records?period=all&workOrderId=${order.id}&source=report`)).body.data;
assert.equal(records.total,3);assert.equal(new Set(records.items.map(r=>r.reportSnapshot.stepId)).size,3);
const exportResponse=await fetch(base+`/api/quality-data/export?period=all&workOrderId=${order.id}&format=xlsx`,{headers:{Cookie:cookies.admin}});
assert.equal(exportResponse.status,200);const excelBytes=await exportResponse.arrayBuffer();assert.ok(excelBytes.byteLength>2000);const book=new ExcelJS.Workbook();await book.xlsx.load(excelBytes);assert.ok(book.getWorksheet('导通检验').rowCount>=3,'continuity tab includes reporting quantities');checks.push({action:'source quantities and responsibility Excel download',status:200});
const output=process.env.PROCESS_QUALITY_QA_OUTPUT||'artifacts/process-quality/http.json';
await fs.mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await fs.writeFile(output,JSON.stringify({passed:true,checks,recordId:record.id,completionId:result.completionId},null,2));
console.log(`Quality reporting HTTP acceptance passed: ${checks.length} checks`);
