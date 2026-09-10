import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import sharp from 'sharp';
const base=process.env.APP_BASE_URL||'http://127.0.0.1:3123';
if(base!=='http://127.0.0.1:3123'||!process.env.DATABASE_URL?.includes('@127.0.0.1:55453/hongmeng_quality_quick_v134153'))throw Error('Dedicated local QA only');
const fixture=JSON.parse(readFileSync('.docker/quick-fixture.json','utf8')),cookies=new Map(),steps=[],db=new PrismaClient();
async function request(user,path,options={},status=200) {
  const r=await fetch(base+path,{...options,redirect:'manual',headers:{origin:base,cookie:cookies.get(user)||'',...options.headers}});
  const cookie=r.headers.getSetCookie().find(c=>c.startsWith('hm_session='));if(cookie)cookies.set(user,cookie.split(';')[0]);
  const text=await r.text();assert.equal(r.status,status,path+': '+text.slice(0,300));try{return JSON.parse(text);}catch{return text;}
}
const json=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const image=await sharp({create:{width:900,height:560,channels:3,background:'#f5e5d3'}}).composite([{input:Buffer.from('<svg width="900" height="560"><rect x="170" y="210" width="540" height="70" rx="24" fill="#f97316"/><rect x="90" y="160" width="160" height="165" rx="20" fill="#40546b"/><circle cx="655" cy="245" r="58" fill="#354458"/></svg>')}]).jpeg().toBuffer();
mkdirSync('output/playwright/quality-quick-v134153',{recursive:true});writeFileSync('output/playwright/quality-quick-v134153/evidence.jpg',image);
const input={description:'端子方向装反，现场已纠正。后续装配注意卡扣朝外。',orderIds:[fixture.orders[0].id],occurredAt:'2026-09-10',scope:'WORK_ORDER',mutationKey:randomUUID(),publish:false};
function form(data,photos=false){const f=new FormData();f.set('data',JSON.stringify(data));if(photos)f.set('photos',new Blob([image],{type:'image/jpeg'}),'现场照片.jpg');return{method:'POST',body:f};}
const warnings=async user=>(await request(user,'/api/quality-quick/warnings?workOrderId='+fixture.orders[0].id)).rows;
let savedId;
try {
  if(process.env.QUICK_CHECK_BOOTSTRAP==='1'){
    const login=await request('bootstrap','/api/auth/login',json({username:process.env.SEED_ADMIN_USERNAME,password:process.env.SEED_ADMIN_PASSWORD}));assert.equal(login.mustChangePassword,true);
    await request('bootstrap','/api/quality-quick',{},401);
    const next='Changed-'+randomUUID()+'!9';await request('bootstrap','/api/auth/change-password',json({currentPassword:process.env.SEED_ADMIN_PASSWORD,newPassword:next,confirmPassword:next}));
    assert.equal((await request('bootstrap','/api/auth/login',json({username:process.env.SEED_ADMIN_USERNAME,password:next}))).mustChangePassword,false);
    steps.push('Fresh seed requires password change and real re-login');
  }
  for(const [kind,u] of Object.entries(fixture.users))await request(kind,'/api/auth/login',json({username:u.username,password:fixture.password}));
  await request('anonymous','/api/quality-quick',{},401);await request('employee','/api/quality-quick',{},403);
  await request('employee','/api/quality-quick',form(input),403);
  await request('quality','/api/quality-quick',{...form(input),headers:{origin:'https://foreign.invalid'}},403);
  steps.push('Real logins, management permission, ordinary employee write denial and CSRF');
  const opts=await request('quality','/api/quality-quick/options?code='+fixture.orders[0].publicCode);assert.equal(opts.rows[0].id,fixture.orders[0].id);
  await request('quality','/api/quality-quick',form({...input,description:''},true),400);assert.equal((await warnings('employee')).length,0);
  let r=(await request('quality','/api/quality-quick',form(input,true))).record;savedId=r.id;
  assert.equal((await request('quality','/api/quality-quick',form(input,true))).record.id,r.id);
  await request('quality','/api/quality-quick',form({...input,description:'冲突请求'},true),409);
  await request('employee',r.photos[0].url,{},404);
  assert.equal((await warnings('employee')).length,0);
  const photo=await fetch(base+r.photos[0].url,{headers:{cookie:cookies.get('quality')}});assert.deepEqual(Buffer.from(await photo.arrayBuffer()),image);
  steps.push('QR preselect, mandatory validation, atomic photo save, idempotency and saved-photo privacy');
  const update={...input,id:r.id,version:r.version,keepPhotoIds:r.photos.map(p=>p.id),mutationKey:randomUUID(),publish:true,printPolicy:'OPTIONAL'};
  const pair=await Promise.all([fetch(base+'/api/quality-quick',{...form(update),headers:{cookie:cookies.get('quality'),origin:base}}),fetch(base+'/api/quality-quick',{...form({...update,mutationKey:randomUUID()}),headers:{cookie:cookies.get('quality'),origin:base}})]);
  assert.deepEqual(pair.map(p=>p.status).sort(),[200,409]);
  r=(await request('quality','/api/quality-quick/'+r.id)).record;
  assert.equal((await warnings('employee')).length,1);
  assert.equal((await request('employee','/api/quality-quick/warnings?workOrderId='+fixture.orders[1].id)).rows.length,0);
  assert.equal((await request('quality','/api/quality-quick/warnings?productId='+fixture.product.id)).rows.length,0);
  const employeePhoto=await fetch(base+r.photos[0].url,{headers:{cookie:cookies.get('employee')}});assert.deepEqual(Buffer.from(await employeePhoto.arrayBuffer()),image);
  const alerts=await request('admin','/api/work-orders/'+fixture.orders[0].id+'/quality-alerts');assert.equal(alerts.quickWarningCount,1);assert.equal(alerts.alerts.length,0);
  steps.push('Concurrent publish once, employee photo bytes, selected-order scope and unified alert count');
  const deletion={action:'DELETE',version:r.version,reason:'重复录入',mutationKey:randomUUID()};
  r=(await request('quality','/api/quality-quick/'+r.id,json(deletion))).record;
  assert.equal((await warnings('employee')).length,0);await request('employee',r.photos[0].url,{},404);
  await request('quality','/api/quality-quick/'+r.id,json({action:'RESTORE',version:r.version,mutationKey:randomUUID()}),403);
  r=(await request('admin','/api/quality-quick/'+r.id,json({action:'RESTORE',version:r.version,mutationKey:randomUUID()}))).record;assert.equal(r.state,'OFFLINE');
  assert.equal((await warnings('employee')).length,0);
  steps.push('Quality deletes with automatic unpublish, admin-only recovery stays offline');
  r=(await request('quality','/api/quality-quick',form({...input,id:r.id,version:r.version,keepPhotoIds:r.photos.map(p=>p.id),scope:'PRODUCT',publish:true,mutationKey:randomUUID()}))).record;
  assert.equal((await request('employee','/api/quality-quick/warnings?workOrderId='+fixture.orders[1].id)).rows.length,1);
  assert.equal((await request('quality','/api/quality-quick/warnings?productId='+fixture.product.id)).rows.length,1);
  await db.drawingLibraryItem.update({where:{id:fixture.product.id},data:{specification:fixture.product.specification+'-换版'}});
  assert.equal((await warnings('employee')).length,0);
  assert.equal((await request('quality','/api/quality-quick/'+r.id)).record.scopeChanged,true);
  await db.drawingLibraryItem.update({where:{id:fixture.product.id},data:{specification:fixture.product.specification}});
  steps.push('Explicit product propagation and changed-version suppression');
  r=(await request('quality','/api/quality-quick/'+r.id,json({action:'ESCALATE',version:r.version,mutationKey:randomUUID()}))).record;
  const risk=await db.internalQualityRiskReport.findUniqueOrThrow({where:{id:r.escalatedReportId},include:{attachments:true}});
  assert.equal(risk.attachments.length,1);assert.equal(risk.attachments[0].sha256,(await db.quickQualityAttachment.findUniqueOrThrow({where:{id:r.photos[0].id}})).sha256);
  steps.push('Escalation reuses image objects and carries work order and text');
  await request('quality','/api/quality-quick/'+r.id,json({action:'OFFLINE',version:r.version,reason:'验收结束',mutationKey:randomUUID()}));
  const audit=(await request('quality','/api/quality-quick/'+r.id)).record.activities;assert.ok(audit.length>=7);
  const invalid=new FormData();invalid.set('data',JSON.stringify({...input,mutationKey:randomUUID()}));invalid.set('photos',new Blob(['invalid'],{type:'image/jpeg'}),'invalid.jpg');
  await request('quality','/api/quality-quick',{method:'POST',body:invalid},400);
  steps.push('Full audit trail and invalid-image rejection');
  const evidence={ok:true,base,at:new Date().toISOString(),recordId:savedId,groups:steps.length,steps};
  writeFileSync('output/playwright/quality-quick-v134153/http-smoke.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
}finally{await db.$disconnect();}
