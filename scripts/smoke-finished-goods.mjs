import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
assert.equal(process.env.FINISHED_GOODS_QA_ALLOW, 'disposable-finished-goods-runtime');
const base=process.env.FINISHED_GOODS_QA_BASE || 'http://127.0.0.1:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const fixture=JSON.parse((await fs.readFile(process.env.FINISHED_GOODS_QA_FIXTURE,'utf8')).replace(/^\uFEFF/,''));
const output=process.env.FINISHED_GOODS_QA_OUTPUT || 'output/finished-goods/http.json';
await fs.mkdir(path.dirname(output),{recursive:true});
const checks=[];const cookies={};
async function call(actor,url,method='GET',data,expected=200,key) {
  const response=await fetch(base+url,{method,redirect:'manual',signal:AbortSignal.timeout(90000),headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),...(method!=='GET'?{Origin:base}:{}),...(data&&!(data instanceof FormData)?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:data instanceof FormData?data:data?JSON.stringify(data):undefined});
  const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=text;}
  assert.equal(response.status,expected,`${method} ${url} ${response.status}: ${text.slice(0,500)}`);
  checks.push({actor,path:url.split('?')[0],method,status:response.status});return {body,response};
}
const mutate=(body,key=randomUUID())=>call('user','/api/finished-goods','POST',body,200,key).then(r=>r.body.data);
const load=()=>call('user',`/api/finished-goods?q=${fixture.marker}&date=${fixture.date}&pageSize=100`).then(r=>r.body.data);
await call('none','/api/finished-goods','GET',undefined,401);
for(const [who,account] of [['user',fixture.user],['admin',fixture.actor]]) {
  const {response}=await call(who,'/api/auth/login','POST',{username:account.username,password:fixture.password});
  cookies[who]=response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];assert.ok(cookies[who]);
}
await call('admin','/api/daily-shipments','POST',{action:'RECORD_SHIPMENT'},410,randomUUID());
await call('admin','/api/daily-shipments','POST',{action:'REVERSE_SHIPMENT'},410,randomUUID());
const initial=await load();assert.equal(initial.rows.length,fixture.lots.length);assert.ok(initial.rows.every(r=>r.pending>0&&r.available===0));
const firstPage=await call('user',`/api/finished-goods?q=${fixture.marker}&pageSize=24`);assert.equal(firstPage.body.data.rows.length,24);assert.equal(firstPage.body.data.total,fixture.lots.length);
const batch=await mutate({action:'CREATE_BATCH',date:fixture.date,name:'上午快件',carrier:'顺丰'});
const batch2=await mutate({action:'CREATE_BATCH',date:fixture.date,name:'下午快件',carrier:'京东'});
let firstShipment;
for(const [i,source] of fixture.lots.entries()) {
  if(i<4) continue;
  const row=initial.rows.find(r=>r.lotId===source.id);assert.ok(row);
  if(i>=12&&i<22) {
    const input={action:'QUICK_SHIP',lotId:row.lotId,version:row.version,quantity:source.quantity,method:'COURIER',carrier:i%2?'京东':'顺丰',waybills:i%4===0?[]:[`SF-QA-${fixture.marker}-${i}`],recipient:'客户收货员',address:'杭州市隔离验收地址',phone:'000-验收号码',boxes:2,batchId:i<17?batch.id:batch2.id,plannedDate:fixture.date,checked:true,receive:true};
    const key=randomUUID();const shipped=await mutate(input,key);
    assert.deepEqual({...await mutate(input,key),replayed:undefined},{...shipped,replayed:undefined});
    firstShipment ||= shipped;
  } else {
    await mutate({action:'RECEIVE',lotId:row.lotId,version:row.version,quantity:source.quantity,checked:true});
    if(i>=22&&i<26) {
      const current=(await load()).rows.find(r=>r.lotId===source.id);
      await mutate({action:'HOLD',lotId:current.lotId,version:current.version,quantity:current.available,reason:'客户要求暂存，等通知出库',dueDate:fixture.date});
    }
  }
}
let snapshot=await load();assert.equal(snapshot.rows.filter(r=>r.status==='shipped').length,10);
const candidate=snapshot.rows.find(r=>r.status==='ready');assert.ok(candidate);
const before=candidate.available;
const draft=await mutate({action:'SAVE_DRAFT',lotId:candidate.lotId,version:candidate.version,quantity:Math.min(before,10),carrier:'顺丰',waybills:['SF-DRAFT-ONLY'],recipient:'客户收货员',address:'杭州市隔离验收地址',plannedDate:fixture.date});
snapshot=await load();assert.equal(snapshot.rows.find(r=>r.lotId===candidate.lotId).available,before);assert.equal(snapshot.rows.filter(r=>r.status==='shipped').length,10);
let shippedRow=snapshot.rows.find(r=>r.shipmentId===firstShipment.id);assert.ok(shippedRow);
await mutate({action:'SAVE_LOGISTICS',shipmentId:shippedRow.shipmentId,shipmentVersion:shippedRow.shipmentVersion,waybills:['SF-UPDATED-1','SF-UPDATED-2'],carrier:'顺丰'});
await mutate({action:'RETURN',lineId:shippedRow.lineId,quantity:2,checked:true,reason:'验收退货，不直接恢复可发'});
snapshot=await load();assert.ok(snapshot.rows.some(r=>r.sourceKind==='RETURN'&&r.blocked===2&&r.available===0));
const print=await call('user',`/workspace/finished-goods/print/${firstShipment.id}`);assert.ok(print.body.includes(firstShipment.number));assert.ok(print.body.includes('SF-UPDATED-1'));
const form=new FormData();form.set('shipmentId',firstShipment.id);form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'装箱凭证.png');
const saved=await call('user','/api/finished-goods/attachments','POST',form);const attachmentId=saved.body.data.id;
const attachment=await call('user',`/api/finished-goods/attachments?id=${attachmentId}`,'GET',undefined,307);
const media=await fetch(attachment.response.headers.get('location'));assert.equal(media.status,200);assert.ok((await media.arrayBuffer()).byteLength>40);
await call('user','/api/finished-goods/attachments','DELETE',{id:attachmentId});await call('user',`/api/finished-goods/attachments?id=${attachmentId}`,'GET',undefined,404);
const exportResponse=await fetch(`${base}/api/finished-goods/export?q=${fixture.marker}&date=${fixture.date}&view=history`,{headers:{Cookie:cookies.user},signal:AbortSignal.timeout(90000)});assert.equal(exportResponse.status,200);
const bytes=Buffer.from(await exportResponse.arrayBuffer());const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);assert.equal(workbook.worksheets[0].rowCount,11);
await fs.writeFile(path.join(path.dirname(output),'shipment-export.xlsx'),bytes);
checks.push({method:'GET',path:'/api/finished-goods/export',status:200,records:10,bytes:bytes.length});
const all24=await call('user',`/api/finished-goods?q=${fixture.marker}&date=${fixture.date}&pageSize=24`);assert.equal(all24.body.data.rows.length,24);assert.ok(all24.body.data.total>=32);
const evidence={passed:true,base,at:new Date().toISOString(),checks:checks.length,results:checks,marker:fixture.marker,fixtureRows:fixture.lots.length,firstShipmentId:firstShipment.id,draftId:draft.id};
await fs.writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output,marker:fixture.marker}));
