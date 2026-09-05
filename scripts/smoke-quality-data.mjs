import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const base=(process.env.QUALITY_DATA_QA_BASE||'http://127.0.0.1:33122').replace(/\/$/,'');
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'loopback-only acceptance');
assert.equal(process.env.QUALITY_DATA_QA_ALLOW,'disposable-quality-runtime');
const fixture=JSON.parse((await fs.readFile(process.env.QUALITY_DATA_QA_FIXTURE||'tmp/quality-runtime/fixture.json','utf8')).replace(/^\uFEFF/,''));
const checks=[],cookies={};
async function request(kind,path,method='GET',data,expected=200){
  const response=await fetch(base+path,{method,headers:{...(cookies[kind]?{Cookie:cookies[kind]}:{}),...(method!=='GET'?{Origin:base}:{}),...(data&&!(data instanceof FormData)?{'Content-Type':'application/json'}:{})},body:data?data instanceof FormData?data:JSON.stringify(data):undefined,redirect:'manual',signal:AbortSignal.timeout(90000)});
  const bytes=Buffer.from(await response.arrayBuffer()),ct=response.headers.get('content-type')||'';
  const body=ct.includes('application/json')?JSON.parse(bytes.toString()):bytes;
  assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),kind+' '+method+' '+path+': '+response.status+' '+(Buffer.isBuffer(body)?body.toString().slice(0,160):JSON.stringify(body)));
  checks.push({kind,method,path:path.split('?')[0],status:response.status});
  return {body,response,bytes};
}
const api='/api/quality-data/';
await request('none',api+'records?period=all','GET',undefined,401);
for(const kind of Object.keys(fixture.users)){
  const {response}=await request(kind,'/api/auth/login','POST',{username:fixture.users[kind].username,password:fixture.password});
  const cookie=response.headers.get('set-cookie')?.match(/hm_session=[^;]+/);
  assert.ok(cookie,'login cookie');cookies[kind]=cookie[0];
}
for(const kind of ['employee','process']){
  await request(kind,api+'records?period=all','GET',undefined,403);
  await request(kind,api+'export?period=all','GET',undefined,403);
  await request(kind,api+'qr/'+fixture.orders[0].publicCode,'GET',undefined,403);
}
await request('quality','/api/field-report/tickets/'+fixture.orders[0].publicCode+'/completions','POST',{},[401,403]);
await request('employee','/api/field-report/tickets/'+fixture.orders[0].publicCode);
for(const kind of ['quality','leader','tooling','admin'])await request(kind,api+'qr/'+fixture.orders[0].publicCode);
const qualityLanding=await request('quality','/field-report/'+fixture.orders[0].publicCode,'GET',undefined,307);
assert.ok(qualityLanding.response.headers.get('location').includes('/quality-capture/'));
const ordinaryLanding=await request('employee','/field-report/'+fixture.orders[0].publicCode);
assert.ok(!ordinaryLanding.body.toString().includes('工单扫码功能'),'ordinary scan has no quality tabs');
const dualLanding=await request('leader','/field-report/'+fixture.orders[0].publicCode);
assert.ok(dualLanding.body.toString().includes('质量填报'),'leader sees dual entry');
function form(type,value='80'){
  return {mode:'FORM',context:{processName:type==='FINAL'?'成品检验':'端子压接',inspectedBy:'现场验收员',team:'质量验收班组',standardRef:'验收样例标准 V1'},summary:'验收样例：检查线束端子，保留原始测量结果。',rows:[{sample:'01',position:'P1 / 红线',item:type==='PULL'?'拉力':'检验项目',standard:'仅用于软件验收的样例标准',lower:'70',upper:'90',value,unit:type==='PULL'?'N':'mm',result:'PASS',note:'验收记录'}]};
}
const records=[];
for(const [index,type] of ['CRIMP','PULL','FINAL','FIRST','PATROL'].entries()){
  const actor=index%2?'tooling':'quality', order=fixture.orders[type==='FINAL'?1:0];
  const input={workOrderId:order.id,sourceQrCode:order.publicCode,type,title:type+' 验收记录',inspectedAt:new Date(Date.now()-60000).toISOString(),data:form(type,index===0?'60':'80'),status:'SUBMITTED',idempotencyKey:randomUUID()};
  const {body}=await request(actor,api+'records','POST',input);
  assert.equal(body.data.result,index===0?'FAIL':'PASS');records.push(body.data);
  const duplicate=await request(actor,api+'records','POST',input);assert.equal(duplicate.body.data.id,body.data.id);
}
await request('quality',api+'records','POST',{workOrderId:fixture.orders[1].id,sourceQrCode:fixture.orders[0].publicCode,type:'FIRST',title:'错单检查',inspectedAt:new Date().toISOString(),data:form('FIRST'),idempotencyKey:randomUUID()},409);
let editable=records[0],data=editable.data;
await request('leader',api+'records/'+editable.id,'PATCH',{version:editable.version,action:'SAVE',title:'越权修改',inspectedAt:editable.inspectedAt,data,reason:'测试'},403);
editable=(await request('quality',api+'records/'+editable.id,'PATCH',{version:editable.version,action:'REVIEW',reason:'确认本次不合格记录'})).body.data;
assert.equal(editable.reviewStatus,'APPROVED');
await request('quality',api+'records/'+editable.id,'PATCH',{version:1,action:'RETURN',reason:'过期版本'},409);
editable=(await request('quality',api+'records/'+editable.id,'PATCH',{version:editable.version,action:'SAVE',reason:'补充说明',title:editable.title,inspectedAt:editable.inspectedAt,data:{...data,summary:'复核后修订验收，重新复核'}})).body.data;
assert.equal(editable.reviewStatus,'UNREVIEWED');
const history=await request('quality',api+'records/'+editable.id+'/revisions/1');
assert.equal(history.body.data.data.summary,data.summary);assert.equal(history.body.data.result,'FAIL');
let fileRecord=(await request('leader',api+'records','POST',{workOrderId:fixture.orders[0].id,type:'PATROL',title:'纸质巡检表归档',inspectedAt:new Date().toISOString(),data:{mode:'FILE',context:{processName:'巡检',inspectedBy:'现场验收员'},rows:[],summary:'纸质巡检表照片验收'},idempotencyKey:randomUUID()})).body.data;
await request('leader',api+'records/'+fileRecord.id,'PATCH',{version:fileRecord.version,action:'SUBMIT',title:fileRecord.title,inspectedAt:fileRecord.inspectedAt,data:fileRecord.data},400);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
const upload=new FormData();upload.set('file',new File([png],'巡检证据.png',{type:'image/png'}));upload.set('version',String(fileRecord.version));
fileRecord=(await request('leader',api+'records/'+fileRecord.id+'/attachments','POST',upload)).body.data;
const file=fileRecord.attachments[0];
const bytes=await request('quality',api+'attachments/'+file.id+'/content');
assert.equal(createHash('sha256').update(bytes.bytes).digest('hex'),file.sha256);
await request('employee',api+'attachments/'+file.id+'/content','GET',undefined,403);
const uploadedVersion=fileRecord.version;
await request('leader',api+'attachments/'+file.id,'DELETE',{version:fileRecord.version,reason:'测试移除证据'});
await request('quality',api+'attachments/'+file.id+'/content','GET',undefined,404);
await request('quality',api+'attachments/'+file.id+'/content?historyVersion='+uploadedVersion);
fileRecord=(await request('leader',api+'records/'+fileRecord.id)).body.data;
upload.set('version',String(fileRecord.version));
fileRecord=(await request('leader',api+'records/'+fileRecord.id+'/attachments','POST',upload)).body.data;
fileRecord=(await request('leader',api+'records/'+fileRecord.id,'PATCH',{version:fileRecord.version,action:'SUBMIT',title:fileRecord.title,inspectedAt:fileRecord.inspectedAt,data:fileRecord.data})).body.data;
assert.equal(fileRecord.result,'PENDING');
await request('leader',api+'attachments/'+file.id,'DELETE',{version:fileRecord.version,reason:'删除唯一附件'},409);
const query='period=all&q='+encodeURIComponent(fixture.marker);
const all=await request('quality',api+'records?'+query);assert.equal(all.body.data.total,6);
const xlsx=await request('quality',api+'export?'+query+'&format=xlsx');
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(xlsx.bytes);assert.equal(workbook.getWorksheet('记录清单').rowCount,9);assert.ok(workbook.getWorksheet('拉力测试'));
const zip=await request('quality',api+'export?'+query+'&format=zip');
const archive=await JSZip.loadAsync(zip.bytes);
assert.ok(Object.keys(archive.files).some(name=>name.endsWith('巡检证据.png')));
await request('leader',api+'records/'+fileRecord.id,'DELETE',{version:fileRecord.version,reason:'越权作废'},403);
fileRecord=(await request('quality',api+'records/'+fileRecord.id,'DELETE',{version:fileRecord.version,reason:'验收回收站'})).body.data;
await request('quality',api+'attachments/'+file.id+'/content','GET',undefined,404);
const deleted=await request('quality',api+'records?'+query+'&deleted=1');assert.equal(deleted.body.data.total,1);
fileRecord=(await request('quality',api+'records/'+fileRecord.id,'PATCH',{version:fileRecord.version,action:'RESTORE',reason:'验收恢复'})).body.data;
assert.equal(fileRecord.deletedAt,null);
await request('quality',api+'attachments/'+file.id+'/content');
const grant=fixture.users.tooling.grants.find(g=>g.profile==='QUALITY_DATA_OPERATOR');
await request('admin','/api/users/'+fixture.users.tooling.id+'/access-grants/'+grant.id,'DELETE',{expectedVersion:grant.version});
await request('tooling',api+'records?period=all','GET',undefined,401);
const relogin=await request('tooling','/api/auth/login','POST',{username:fixture.users.tooling.username,password:fixture.password});
cookies.tooling=relogin.response.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];
await request('tooling',api+'records?period=all','GET',undefined,403);
await request('tooling',api+'attachments/'+file.id+'/content','GET',undefined,403);
await request('tooling','/api/field-report/tickets/'+fixture.orders[0].publicCode);
const report={ok:true,checks:checks.length,recordIds:records.map(r=>r.id),fileRecordId:fileRecord.id,orders:fixture.orders,details:checks};
if(process.env.QUALITY_DATA_QA_OUTPUT)await fs.writeFile(process.env.QUALITY_DATA_QA_OUTPUT,JSON.stringify(report,null,2));
console.log(JSON.stringify({ok:true,checks:checks.length,records:6,attachmentsVerified:true,excelRows:6,zipVerified:true,revocationVerified:true}));
