import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import XLSX from 'xlsx';

assert.equal(process.env.SAMPLE_BRANCH_QA_ALLOW, 'disposable-sample-branches');
const base = process.env.SAMPLE_BRANCH_QA_BASE || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const tag = 'SBR-' + randomUUID().slice(0,8), checks = [];
let cookie = '';
async function req(label, url, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
  const form = body instanceof FormData;
  const response = await fetch(base+url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: base, ...(!form && body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : type.includes('text/') ? await response.text() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, `${label}: ${JSON.stringify(data).slice(0,600)}`);
  checks.push({ label, status: response.status });
  if (url === '/api/auth/login') cookie = response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
  return data;
}
await req('sample list requires login', '/api/sample-tasks?summary=true', undefined, 401);
if (process.env.SAMPLE_BRANCH_INITIAL_PASSWORD) {
  await req('initialize disposable administrator', '/api/auth/login', { username: process.env.SEED_ADMIN_USERNAME, password: process.env.SAMPLE_BRANCH_INITIAL_PASSWORD });
  await req('change disposable seed password', '/api/auth/change-password', { currentPassword: process.env.SAMPLE_BRANCH_INITIAL_PASSWORD, newPassword: process.env.SMOKE_ADMIN_CHANGED_PASSWORD, confirmPassword: process.env.SMOKE_ADMIN_CHANGED_PASSWORD });
}
await req('login isolated runtime', '/api/auth/login', { username: process.env.SEED_ADMIN_USERNAME, password: process.env.SMOKE_ADMIN_CHANGED_PASSWORD }); assert.ok(cookie);
const config = (await req('load existing review settings', '/api/quality-fixtures')).data;
await req('configure isolated reviewers', '/api/quality-fixtures', { action: 'SAVE_SETTINGS', version: config.settings?.version, supervisorIds: [config.actorId], qualityIds: [config.actorId] });
const today = new Date(Date.now()+8*3600000).toISOString().slice(0,10), monday = new Date(today+'T00:00:00Z'); monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7); const week = monday.toISOString().slice(0,10);
const create = async type => (await req('create '+type, '/api/sample-tasks', { taskType: type, customerName: tag, productName: 'Sample cable', specification: tag+'-'+type, customerLevelCode: 'A', sampleQuantity: 5, planWeekStartDate: week, issuedDate: today, dueDate: today, planRemark: 'Isolated sample branch verification' }, 201)).task;
let repeat = await create('REPEAT'), fresh = await create('NEW');
const detail = async task => (await req('reload sample task', `/api/sample-tasks/${task.id}`)).task;
const patch = (task, input, expected = 200) => req(input.action, `/api/sample-tasks/${task.id}`, { expectedVersion: task.version, ...input }, expected, 'PATCH');
for (const task of [repeat,fresh]) {
  const materials = (await req('sample material task exists', `/api/sample-tasks/${task.id}/materials`)).task;
  assert.equal(materials.sampleTaskId, task.id); assert.equal(materials.status, 'pending');
  const requirements = ['PURCHASED','CUSTOMER'].map((supplySource,i)=>({id:'line-'+i,model:'CN-'+i,quantity:5,prepared:0,unit:'个',supplySource}));
  const saved = (await req('save sample material demand', `/api/sample-tasks/${task.id}/materials`, { version:materials.version,requirements },200,'PATCH')).task;
  await req('cannot confirm incomplete material', `/api/sample-tasks/${task.id}/materials`, { version:saved.version,requirements,confirm:true },409,'PATCH');
}
const filtered = await req('repeat weekly summary', `/api/sample-tasks?view=ALL&taskType=REPEAT&week=${week}&summary=true&keyword=${tag}`);
assert.equal(filtered.tasks.length, 1); assert.equal(filtered.tasks[0].id, repeat.id); assert.equal(filtered.tasks[0].photos.length, 0);
await patch(repeat, { action: 'COMPLETE_REPEAT', mutationId: randomUUID(), quantity: 1, workDate: today }, 409);
await req('repeat cannot scan capture', `/api/sample-tasks/code/${repeat.qrCode}`, undefined, 404);
await req('repeat cannot save process data', `/api/sample-tasks/${repeat.id}/entries`, { kind: 'NOTICE', label: 'forbidden', payload: { text: 'none' }, expectedTaskVersion: repeat.version, clientMutationId: randomUUID() }, 409);
const pdf = await PDFDocument.create(); pdf.addPage([640,400]).drawText('SAMPLE DRAWING - CONTROLLED ACCEPTANCE', { x: 40, y: 300, size: 18 }); const bytes = await pdf.save();
async function approve(task) {
  await req('fixture selection before BOM', '/api/quality-fixtures', { action: 'SET_REQUIREMENT', productIds: [task.drawingLibraryItemId], needFixture: true });
  const form = new FormData(); form.set('product',task.drawingLibraryItemId); form.set('kind','drawing'); form.set('file',new Blob([bytes],{type:'application/pdf'}),`${tag}.pdf`);
  await req('upload drawing to object storage', '/api/quality-fixtures/files', form);
  await req('synchronize sample drawings', `/api/sample-tasks/${task.id}/documents`, {});
  let context = await req('load drawing approval in sample', `/api/sample-tasks/${task.id}/documents`); let pack = context.packages[0];
  assert.equal(pack.sopFiles.length,0); assert.equal(pack.drawingFiles.length,1);
  const content = await req('download stored drawing', `/api/drawing-library/files/${pack.drawingFiles[0].id}/content`); assert.ok(Buffer.isBuffer(content) && content.byteLength > 100);
  if (pack.status === 'DRAFT') { await req('submit drawing only', '/api/quality-fixtures', { action:'SUBMIT',id:pack.id,version:pack.version }); context=await req('reload submitted review',`/api/sample-tasks/${task.id}/documents`);pack=context.packages[0]; }
  await req('quality reviews first', '/api/quality-fixtures', { action:'APPROVE',id:pack.id,version:pack.version,reviewRole:'QUALITY',confirmed:true });
  if (task.taskType==='REPEAT') await patch(task,{action:'COMPLETE_REPEAT',mutationId:randomUUID(),quantity:1},409);
  context=await req('load supervisor remaining review',`/api/sample-tasks/${task.id}/documents`); pack=context.packages[0];
  await req('supervisor confirms second', '/api/quality-fixtures', { action:'APPROVE',id:pack.id,version:pack.version,reviewRole:'SUPERVISOR',confirmed:true });
  const print = await req('approved sample printing', `/sample-print/${task.id}`); assert.match(print,/Sample cable|样品/);
}
await approve(repeat); await approve(fresh);
const completion = { action:'COMPLETE_REPEAT', mutationId:randomUUID(), quantity:2,workDate:today,note:'Part 1' };
const first = await patch(repeat,completion); await patch(repeat,completion); repeat=first.task; assert.equal(repeat.completedQuantity,2); assert.equal(repeat.status,'IN_PROGRESS');
await patch(repeat,{...completion,quantity:1},409);
await patch(repeat,{action:'COMPLETE_REPEAT',mutationId:randomUUID(),quantity:4,workDate:today},400);
repeat=(await patch(repeat,{action:'COMPLETE_REPEAT',mutationId:randomUUID(),quantity:3,workDate:today})).task;
assert.equal(repeat.status,'COMPLETED');assert.equal(repeat.completedQuantity,5);assert.equal(repeat.finishedGoodsCount,2);
fresh=await detail(fresh); fresh=(await patch(fresh,{action:'COMPLETE',confirmNoData:true,workDate:today})).task;assert.equal(fresh.status,'COMPLETED');assert.equal(fresh.completedQuantity,5);
for (const task of [repeat,fresh]) {
  const goods=(await req('sample finished warehouse source',`/api/finished-goods?sampleTaskId=${task.id}&filter=all&scope=all`)).data;
  assert.equal(goods.rows.reduce((n,r)=>n+r.pending,0),5);assert.ok(goods.rows.every(r=>r.sampleTaskId===task.id && r.note.startsWith('样品完成') && r.productionWorkDate===today));
  const source=goods.rows[0];
  await req('receive sample finished stock','/api/finished-goods',{action:'RECEIVE',lotId:source.lotId,quantity:source.pending,version:source.version,checked:true});
  let lot=(await req('read sample receipt evidence',`/api/finished-goods?lotId=${source.lotId}`)).data.lot;
  assert.equal(lot.pending,0);assert.equal(lot.available,source.pending);
  await req('ship sample from finished warehouse','/api/finished-goods',{action:'QUICK_SHIP',lotId:lot.id,quantity:1,version:lot.version,checked:true});
  lot=(await req('read sample shipment evidence',`/api/finished-goods?lotId=${source.lotId}`)).data.lot;
  assert.equal(lot.available,source.pending-1);assert.ok(lot.ledger.some(e=>e.kind==='SHIP' && e.quantity===1));assert.match(lot.note,/样品完成/);
}
const old=(await req('find completed repeat',`/api/sample-tasks?view=COMPLETED&taskType=REPEAT&week=${week}&summary=true&keyword=${tag}`)).tasks;assert.equal(old[0].id,repeat.id);
await req('download branch export',`/api/sample-tasks/export?view=ALL&taskType=REPEAT&week=${week}&keyword=${tag}`);
const template = await req('download extended import template','/api/sample-tasks/import/template');
const workbook = XLSX.read(template, { type: 'buffer' });
const cells = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
const headers = cells.find(row => row.includes('样品类型（选填）')); assert.ok(headers && headers.includes('计划周（选填）'));
const importedBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(importedBook, XLSX.utils.aoa_to_sheet([headers, ...['NEW','REPEAT'].map(type => [tag,'Imported sample',tag+'-IMPORT-'+type,'A',3,today,'',today,2,type,week])]), '样品计划');
const importForm = new FormData(); importForm.set('file', new Blob([XLSX.write(importedBook,{type:'buffer',bookType:'xlsx'})]), 'sample-branches.xlsx');
const preview = await req('preview mixed sample branches Excel', '/api/sample-tasks/import/preview', importForm);
assert.equal(preview.summary.blocked,0);assert.deepEqual(preview.rows.map(r=>r.taskType),['NEW','REPEAT']);assert.ok(preview.rows.every(r=>r.planWeekStartDate===week));
const imported = await req('commit mixed sample branches', '/api/sample-tasks/import/commit', { clientMutationId:randomUUID(), fileName:'sample-branches.xlsx', rows:preview.rows, decisions:Object.fromEntries(preview.rows.map(r=>[r.rowNumber,{mode:'create'}])) });
assert.equal(imported.createdTaskCount,2);
const importedList = await req('verify imported sample plans', `/api/sample-tasks?view=ALL&week=${week}&summary=true&keyword=${tag}-IMPORT`);
assert.equal(importedList.tasks.length,2);assert.ok(importedList.tasks.every(t=>t.planWeekStartDate===week && t.documentReviewRequired));
const output=process.env.SAMPLE_BRANCH_QA_OUTPUT || 'artifacts/sample-branches/http.json';await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({ok:true,tag,base,checks,taskIds:[repeat.id,fresh.id],note:'Disposable runtime only; image remains unmodified.'},null,2));console.log(`Sample branch HTTP acceptance: ${checks.length} checks passed`);
