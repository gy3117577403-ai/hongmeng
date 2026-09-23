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
const create = async type => (await req('create '+type, '/api/sample-tasks', { taskType: type, customerName: tag, productName: 'Sample cable', specification: tag+'-'+type, customerLevelCode: 'A', sampleQuantity: 5, planWeekStartDate: week, issuedDate: today, dueDate: today, plannedCompletionDate: today, planRemark: 'Isolated sample branch verification' }, 201)).task;
let repeat = await create('REPEAT'), fresh = await create('NEW');
const detail = async task => (await req('reload sample task', `/api/sample-tasks/${task.id}`)).task;
const patch = (task, input, expected = 200) => req(input.action, `/api/sample-tasks/${task.id}`, { expectedVersion: task.version, ...input }, expected, 'PATCH');
for (const task of [repeat,fresh]) {
  const materials = (await req('sample material task exists', `/api/sample-tasks/${task.id}/materials`)).task;
  assert.equal(materials.sampleTaskId, task.id); assert.equal(materials.status, 'pending');
  const url=`/api/sample-tasks/${task.id}/materials`;
  const complete=(await req('physical kitting complete without BOM or material list',url,{version:materials.version,action:'complete'},200,'PATCH')).task;
  assert.equal(complete.status,'completed');assert.ok(complete.completedAt);assert.equal(complete.requirements.length,0);
  const lines=['PURCHASED','CUSTOMER'].map((supplySource,i)=>({supplySource,materialModel:'CN-'+i}));
  await req('multi-line report rolls back on missing model',url,{version:complete.version,action:'report_shortages',shortages:[lines[0],{supplySource:'CUSTOMER',materialModel:''}]},400,'PATCH');
  const unchanged=(await req('failed report creates no shortage',url)).task;assert.equal(unchanged.version,complete.version);assert.equal(unchanged.activeExceptions.length,0);
  const reported=(await req('report purchased and customer material shortages atomically',url,{version:complete.version,action:'report_shortages',shortages:lines},200,'PATCH')).task;
  assert.equal(reported.status,'exception');assert.equal(reported.activeExceptions.length,2);assert.ok(reported.activeExceptions.every(e=>e.followUpId && e.shortageQuantity===null));
  await req('duplicate report rejected by version',url,{version:complete.version,action:'report_shortages',shortages:lines},409,'PATCH');
  await req('open shortages prevent manual complete',url,{version:reported.version,action:'complete'},409,'PATCH');
  let current=reported;
  for(const event of reported.activeExceptions) current=(await req('warehouse confirms individual arrival',url,{version:current.version,action:'resolve',exceptionId:event.id,resolution:'pending',note:'实物到料确认'},200,'PATCH')).task;
  assert.equal(current.status,'pending');assert.equal(current.activeExceptions.length,0);
  current=(await req('explicit final kitting confirmation',url,{version:current.version,action:'complete'},200,'PATCH')).task;
  assert.equal(current.status,'completed');assert.ok(current.activities.some(a=>a.action==='report_exception'));
}
const warehouseList=await req('separate warehouse completed filter',`/api/sample-tasks?warehouse=true&view=ALL&materialStatus=completed&summary=true&keyword=${tag}`);
assert.equal(warehouseList.pagination.total,2);assert.equal(warehouseList.materialCounts.completed,2);assert.equal(warehouseList.materialCounts.all,2);
const laterWeek=new Date(monday.getTime()+7*86400000).toISOString().slice(0,10);
await req('batch reschedule requires reason','/api/sample-tasks/schedule',{items:[{id:repeat.id,version:repeat.version}],week:laterWeek},400,'PATCH');
await req('stale item makes entire batch fail','/api/sample-tasks/schedule',{items:[{id:repeat.id,version:repeat.version},{id:fresh.id,version:99999}],week:laterWeek,reason:'冲突检查'},409,'PATCH');
assert.equal((await detail(repeat)).planWeekStartDate,week);
await req('batch reschedule two sample plans','/api/sample-tasks/schedule',{items:[{id:repeat.id,version:repeat.version},{id:fresh.id,version:fresh.version}],week:laterWeek,reason:'样品排期调整'},200,'PATCH');
repeat=await detail(repeat);fresh=await detail(fresh);
assert.equal(repeat.planWeekStartDate,laterWeek);assert.equal(repeat.dueDate,today);assert.equal(repeat.plannedCompletionDate,today);
await req('restore test week with audit','/api/sample-tasks/schedule',{items:[{id:repeat.id,version:repeat.version},{id:fresh.id,version:fresh.version}],week,reason:'恢复验收计划周'},200,'PATCH');
repeat=await detail(repeat);fresh=await detail(fresh);assert.ok(repeat.scheduleHistory.some(c=>c.reason==='样品排期调整'));

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
  if (task.taskType==='REPEAT') await patch(task,{action:'COMPLETE_REPEAT',mutationId:randomUUID(),quantity:1,workDate:today},409);
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
fresh=await detail(fresh); fresh=(await patch(fresh,{action:'COMPLETE_PHYSICAL',mutationId:randomUUID(),quantity:5,confirmNoData:true,workDate:today})).task;assert.equal(fresh.status,'COMPLETED');assert.equal(fresh.completedQuantity,5);
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
const updateTarget=importedList.tasks.find(t=>t.taskType==='NEW');
const updateRow={...preview.rows.find(r=>r.taskType==='NEW'),sampleQuantity:3,unitPlannedMinutes:'3.75',unitPlannedMilliseconds:225000};
const updateImport={clientMutationId:randomUUID(),fileName:'sample-correction.xlsx',rows:[updateRow],decisions:{[updateRow.rowNumber]:{mode:'reuse',drawingLibraryItemId:updateTarget.drawingLibraryItemId}},planDecisions:{[updateRow.rowNumber]:{mode:'update',taskId:updateTarget.id,expectedVersion:updateTarget.version,reason:'隔离验收：调整数量与单套计划工时'}}};
const updatedImport=await req('explicit existing-plan import updates one plan','/api/sample-tasks/import/commit',updateImport);
assert.equal(updatedImport.updatedTaskCount,1);assert.equal(updatedImport.createdTaskCount,0);
assert.deepEqual(await req('replayed import returns the original batch','/api/sample-tasks/import/commit',updateImport),updatedImport);
const updatedPlan=await detail(updateTarget);assert.equal(updatedPlan.sampleQuantity,3);assert.equal(updatedPlan.unitPlannedMilliseconds,225000);assert.equal(updatedPlan.totalPlannedMilliseconds,'675000');
const staleImport=await req('stale import cannot silently overwrite changes','/api/sample-tasks/import/commit',{...updateImport,clientMutationId:randomUUID()});
assert.equal(staleImport.blockedCount,1);assert.equal(staleImport.updatedTaskCount,0);assert.equal((await detail(updateTarget)).version,updatedPlan.version);
await req('oversized import is rejected without truncating rows','/api/sample-tasks/import/commit',{clientMutationId:randomUUID(),rows:Array.from({length:501},()=>updateRow)},400);
// A duplicate in an approved sample must never roll back its completion or warehouse transfer.
async function parameterSample(values, position='A端', physical=true) {
  let task=(await req('create parameter sample on approved product','/api/sample-tasks',{drawingLibraryItemId:fresh.drawingLibraryItemId,taskType:'NEW',sampleQuantity:2,customerLevelCode:'A'},201)).task;
  task=(await req('save connector sample data',`/api/sample-tasks/${task.id}/entries`,{kind:'STRIPPING',label:position,payload:{model:tag+'-CN',outerPeelMm:String(values),positionLabel:position},expectedTaskVersion:task.version,clientMutationId:randomUUID()},201)).task;
  task=(await req('submit connector sample',`/api/sample-tasks/${task.id}/submit`,{expectedVersion:task.version,clientMutationId:randomUUID()})).task;
  const review={decision:'CONFIRM',...(physical?{completion:{quantity:2,workDate:today}}:{}),submissionId:task.activeSubmission.id,submissionRevision:task.activeSubmission.revision,expectedTaskVersion:task.version,clientMutationId:randomUUID()};
  await req('approve sample even with differing connector parameters',`/api/sample-tasks/${task.id}/review`,review);
  await req('replayed package never transfers twice',`/api/sample-tasks/${task.id}/review`,review);
  task=await detail(task);if(!physical){assert.equal(task.status,'IN_PROGRESS');assert.equal(task.completedQuantity,0);assert.equal(task.finishedGoodsCount,0);return task;}assert.equal(task.status,'COMPLETED');assert.equal(task.completedQuantity,2);assert.equal(task.finishedGoodsCount,1);
  const goods=(await req('duplicate parameters allow finished goods transfer',`/api/finished-goods?sampleTaskId=${task.id}&filter=all&scope=all`)).data;
  assert.equal(goods.rows.reduce((sum,row)=>sum+row.pending,0),2);
  return task;
}
let reviewOnly=await parameterSample(13,'审核资料验收',false);
reviewOnly=(await patch(reviewOnly,{action:'COMPLETE_PHYSICAL',mutationId:randomUUID(),quantity:1,workDate:today})).task;
assert.equal(reviewOnly.status,'IN_PROGRESS');assert.equal(reviewOnly.completedQuantity,1);assert.equal(reviewOnly.finishedGoodsCount,1);
const actual=reviewOnly.completions[0];
reviewOnly=(await patch(reviewOnly,{action:'CORRECT_COMPLETION',mutationId:randomUUID(),completionId:actual.id,quantity:0,workDate:today,reason:'隔离验收：修正录入'})).task;
assert.equal(reviewOnly.completedQuantity,0);assert.equal(reviewOnly.stockSummary.pending,0);
const originalParameterSample=await parameterSample(18);
const equalParameterSample=await parameterSample(18);assert.equal(equalParameterSample.parameterConflictCount,0);
const differentParameterSample=await parameterSample(22);assert.equal(differentParameterSample.parameterConflictCount,1);
let conflicts=await req('list deferred sample parameters',`/api/connector-parameters/conflicts?keyword=${tag}`);
let conflict=conflicts.items.find(item=>item.taskId===differentParameterSample.id);assert.ok(conflict);assert.equal(conflict.candidate.outerPeelMm,'22');assert.equal(conflict.current[0].values.outerPeelMm,'18');
const discard={action:'DISCARD',expectedVersion:conflict.version};
await req('delete only the pending duplicate',`/api/connector-parameters/conflicts/${conflict.id}`,discard,200,'PATCH');
await req('duplicate deletion is idempotent',`/api/connector-parameters/conflicts/${conflict.id}`,discard,200,'PATCH');
let completedTask=await detail(differentParameterSample);assert.equal(completedTask.parameterConflictCount,0);assert.equal(completedTask.entries[0].payload.outerPeelMm,'22');assert.equal(completedTask.finishedGoodsCount,1);assert.equal(completedTask.status,'COMPLETED');
const replaceParameterSample=await parameterSample(25);
conflicts=await req('read pending replacement comparison',`/api/connector-parameters/conflicts?keyword=${tag}`);conflict=conflicts.items.find(item=>item.taskId===replaceParameterSample.id);
await req('stale comparison rejected',`/api/connector-parameters/conflicts/${conflict.id}`,{action:'REPLACE',expectedVersion:conflict.version,currentSignature:'stale'},409,'PATCH');
const replaceInput={action:'REPLACE',expectedVersion:conflict.version,currentSignature:conflict.currentSignature};
await req('cover product parameter and keep original revision',`/api/connector-parameters/conflicts/${conflict.id}`,replaceInput,200,'PATCH');
await req('cover operation is idempotent',`/api/connector-parameters/conflicts/${conflict.id}`,replaceInput,200,'PATCH');
completedTask=await detail(replaceParameterSample);assert.equal(completedTask.parameterConflictCount,0);assert.equal(completedTask.finishedGoodsCount,1);assert.equal(completedTask.status,'COMPLETED');
const unchangedSource=await detail(originalParameterSample);assert.equal(unchangedSource.entries[0].payload.outerPeelMm,'18');
const history=await req('null-week completed samples are reachable',`/api/sample-tasks?view=COMPLETED&taskType=NEW&keyword=${tag}&summary=true`);assert.ok(history.tasks.some(t=>t.id===originalParameterSample.id));assert.ok(history.globalCompleted>=4);
const records=await req('retained parameter conflict history',`/api/connector-parameters/conflicts?status=RESOLVED&keyword=${tag}`);assert.ok(records.items.some(item=>item.id===conflict.id&&item.resolution==='REPLACE'));

// Document quick actions run against the same real HTTP/S3 runtime as the released image.
const replacementTask=(await req('create replacement acceptance sample','/api/sample-tasks',{taskType:'REPEAT',customerName:tag,productName:'Sample cable',specification:tag+'-REPLACE',customerLevelCode:'A',sampleQuantity:2,planWeekStartDate:week,issuedDate:today,dueDate:today,plannedCompletionDate:today},201)).task;
await approve(replacementTask);
const productUrl=`/api/drawing-library/${replacementTask.drawingLibraryItemId}`;
let product=(await req('read product before replacement',productUrl)).item;
await req('restore lifecycle selector independently of SOP',productUrl+'/metadata',{sopStage:'validating',needsConfirmation:true},200,'PATCH');
product=(await req('read saved lifecycle fields',productUrl)).item;assert.equal(product.sopMetadata.sopStage,'validating');assert.equal(product.needsConfirmation,true);
const original=product.files[0];
const signed=await fetch(base+`/api/drawing-library/files/${original.id}/download`,{headers:{Cookie:cookie},redirect:'manual'});
assert.equal(signed.status,307);const oldObjectUrl=signed.headers.get('location');assert.ok(oldObjectUrl);
const replacementForm=(content=bytes)=>{const form=new FormData();form.set('categoryId',original.categoryId);form.set('replaceFileId',original.id);form.set('discardPrevious','true');form.set('file',new Blob([content],{type:'application/pdf'}),'corrected.pdf');form.set('remark','Corrected dimensions');return form;};
await req('invalid replacement preserves old document',productUrl+'/files/upload',replacementForm(new TextEncoder().encode('invalid pdf')),400);
await req('old document still readable after failed upload',`/api/drawing-library/files/${original.id}/content`);
const replaced=(await req('replace approved drawing without BOM',productUrl+'/files/upload',replacementForm())).file;
const replay=(await req('lost response retry returns committed replacement',productUrl+'/files/upload',replacementForm())).file;assert.equal(replay.id,replaced.id);
await req('old original cannot be previewed',`/api/drawing-library/files/${original.id}/content`,undefined,404);
await req('old original cannot be restored',`/api/drawing-library/files/${original.id}/restore`,{},404);
const trash=await req('retired original not in recycle bin','/api/drawing-library/trash?itemId='+product.id);assert.ok(!(trash.files||[]).some(f=>f.id===original.id));
await req('replacement downloads real bytes',`/api/drawing-library/files/${replaced.id}/content`);
let replacementPackage,objectDeleted=false;
for(let attempt=0;attempt<40;attempt++){
 const docs=await req('wait for replacement review synchronization',`/api/sample-tasks/${replacementTask.id}/documents`);
 replacementPackage=docs.packages[0];
 const object=await fetch(oldObjectUrl,{signal:AbortSignal.timeout(10000)});await object.arrayBuffer();objectDeleted=object.status===404;
 if(objectDeleted&&replacementPackage?.drawingFiles?.some(f=>f.id===replaced.id)&&replacementPackage.status==='REVIEWING')break;
 await new Promise(resolve=>setTimeout(resolve,1500));
}
assert.ok(objectDeleted,'old S3 original is physically removed, including previously signed download');
assert.equal(replacementPackage.status,'REVIEWING');assert.equal(replacementPackage.supervisorName,'');assert.equal(replacementPackage.qualityName,'');assert.equal(replacementPackage.supervisorAt,null);assert.equal(replacementPackage.qualityAt,null);
assert.ok(replacementPackage.drawingFiles.some(f=>f.id===replaced.id));
await req('quality rechecks replacement','/api/quality-fixtures',{action:'APPROVE',id:replacementPackage.id,version:replacementPackage.version,reviewRole:'QUALITY',confirmed:true});
replacementPackage=(await req('read second replacement review',`/api/sample-tasks/${replacementTask.id}/documents`)).packages[0];
await req('supervisor rechecks replacement','/api/quality-fixtures',{action:'APPROVE',id:replacementPackage.id,version:replacementPackage.version,reviewRole:'SUPERVISOR',confirmed:true});
await req('replacement sample prints after both reviewers',`/sample-print/${replacementTask.id}`);
product=(await req('quick states survive replacement',productUrl)).item;assert.equal(product.sopMetadata.sopStage,'validating');assert.equal(product.needsConfirmation,true);assert.ok(!product.files.some(f=>f.id===original.id));

// Prepare an actual spreadsheet for the browser upload flow, never production data.
if(process.env.SAMPLE_PLAN_BROWSER_FIXTURE){
 const fixturePath=process.env.SAMPLE_PLAN_BROWSER_FIXTURE;
 await fs.mkdir(path.dirname(fixturePath),{recursive:true});
 const excelPath=path.join(path.dirname(fixturePath),'sample-plan-ui.xlsx');
 const uiBook=XLSX.utils.book_new();
 const uiRows=Array.from({length:24},(_,index)=>[tag+'-UI','界面验收线束',tag+'-UI-'+String(index+1).padStart(2,'0'),'A',24,today,'',today,2,index===23?'REPEAT':'','',today,index===22?'':12.5,'UI-ORDER-'+index,'1','','导入后应立即可见']);
 XLSX.utils.book_append_sheet(uiBook,XLSX.utils.aoa_to_sheet([headers,...uiRows]),'样品计划');
 await fs.writeFile(excelPath,XLSX.write(uiBook,{type:'buffer',bookType:'xlsx'}));
 await fs.writeFile(fixturePath,JSON.stringify({marker:tag,week,username:process.env.SEED_ADMIN_USERNAME,password:process.env.SMOKE_ADMIN_CHANGED_PASSWORD,excelPath,completedId:fresh.id}));
}

const output=process.env.SAMPLE_BRANCH_QA_OUTPUT || 'artifacts/sample-branches/http.json';await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({ok:true,tag,base,checks,taskIds:[repeat.id,fresh.id],note:'Disposable runtime only; image remains unmodified.'},null,2));console.log(`Sample branch HTTP acceptance: ${checks.length} checks passed`);
