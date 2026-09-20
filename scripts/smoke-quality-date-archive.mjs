import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
export async function runPaperSmoke(type, output) {
  const base=(process.env.QUALITY_DATA_QA_BASE||'http://127.0.0.1:3246').replace(/\/$/,'');
  assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));assert.equal(process.env.QUALITY_DATA_QA_ALLOW,'disposable-quality-runtime');
  const fixture=JSON.parse((await fs.readFile(process.env.QUALITY_DATA_QA_FIXTURE,'utf8')).replace(/^\uFEFF/,'')),cookies={},checks=[];
  async function request(kind,path,method='GET',data,expected=200){const response=await fetch(base+path,{method,redirect:'manual',headers:{...(cookies[kind]?{Cookie:cookies[kind]}:{}),...(method!=='GET'?{Origin:base}:{}),...(data&&!(data instanceof FormData)?{'Content-Type':'application/json'}:{})},body:data?data instanceof FormData?data:JSON.stringify(data):undefined,signal:AbortSignal.timeout(90000)});const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,expected,path+': '+bytes.toString().slice(0,280));checks.push({method,path:path.split('?')[0],status:expected});const body=response.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes):null;return{response,bytes,data:body?.data,body};}
  for(const kind of ['quality','employee']){const r=await request(kind,'/api/auth/login','POST',{username:fixture.users[kind].username,password:fixture.password});cookies[kind]=r.response.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];}
  const api='/api/quality-data/', marker=type+'-archive-'+randomUUID(),title=(type==='FIRST'?'首检报表':'巡检报表')+' · 多产品纸质记录';
  for(const endpoint of ['paper-records','paper-export']){await request('anonymous',api+endpoint+'?type='+type,'GET',undefined,401);await request('employee',api+endpoint+'?type='+type,'GET',undefined,403);}
  const input={type,title,inspectedAt:'2001-01-03T00:00',data:{mode:'FILE',context:{},rows:[],summary:marker,paper:{dateEnd:'2001-01-05',area:''}},idempotencyKey:randomUUID()};
  for(const binding of [{workOrderId:fixture.orders[0].id},{sourceQrCode:fixture.orders[0].publicCode},{inspectionStepId:'any'}])await request('quality',api+'records','POST',{...input,...binding,idempotencyKey:randomUUID()},400);
  let r=(await request('quality',api+'records','POST',input)).data;
  assert.equal(r.workOrderId,null);assert.equal(r.inspectionStepId,null);assert.equal(r.data.context.inspectedBy,'');
  assert.equal((await request('quality',api+'records','POST',input)).data.id,r.id);
  const metadata=r=>({title:r.title,inspectedAt:r.inspectedAt,data:r.data,version:r.version});
  await request('quality',api+'records/'+r.id,'PATCH',{...metadata(r),action:'SUBMIT'},400);
  const png=await sharp({create:{width:900,height:1250,channels:3,background:'#fffdf5'}}).composite([{input:Buffer.from('<svg width="900" height="1250"><text x="60" y="80" font-size="36">PAPER ARCHIVE QA / '+type+'</text>'+Array.from({length:18},(_,i)=>'<path d="M50 '+(130+i*56)+' H850" stroke="#8597a8"/>').join('')+'<path d="M50 130V1138 M250 130V1138 M500 130V1138 M850 130V1138" stroke="#8597a8"/><text x="65" y="175" font-size="20">Product A</text><text x="65" y="230" font-size="20">Product B</text></svg>')}]).png().toBuffer();
  async function upload(record,name){const form=new FormData();form.set('file',new File([png],name,{type:'image/png'}));form.set('version',String(record.version));form.set('reason','补充纸表照片');return(await request('quality',api+'records/'+record.id+'/attachments','POST',form)).data;}
  r=await upload(r,marker+'-01.png');const firstFile=r.attachments[0];
  r=(await request('quality',api+'records/'+r.id,'PATCH',{...metadata(r),action:'SUBMIT'})).data;assert.equal(r.status,'SUBMITTED');assert.equal(r.result,'PENDING');
  const query=(extra={})=>new URLSearchParams({type,period:'all',q:marker,...extra});
  const list=async(extra={})=>(await request('quality',api+'paper-records?'+query(extra))).data;
  const before=(await list()).items[0];assert.ok(before.activity.firstUploadedAt);assert.ok(before.activity.uploadedBy);
  for(const date of ['2001-01-03','2001-01-04','2001-01-05'])assert.equal((await list({period:'today',date})).total,1);
  assert.equal((await list({period:'today',date:'2001-01-06'})).total,0);assert.equal((await list({period:'today',date:'2001-01-04',timeField:'upload'})).total,0);
  r=await upload(r,marker+'-02.png');const after=(await list({mine:'1',status:'SUBMITTED',q:marker+'-02.png'})).items[0];assert.equal(after.id,r.id);assert.equal(after.activity.firstUploadedAt,before.activity.firstUploadedAt);assert.ok(after.activity.lastUploadedAt>=before.activity.lastUploadedAt);
  r=(await request('quality',api+'records/'+r.id,'PATCH',{...metadata(r),action:'SAVE',reason:'补充说明',data:{...r.data,summary:marker+' 更新备注'}})).data;
  assert.equal((await list()).items[0].activity.lastUploadedAt,after.activity.lastUploadedAt);
  const original=(await request('quality',api+'attachments/'+firstFile.id+'/content')).bytes;assert.equal(createHash('sha256').update(original).digest('hex'),firstFile.sha256);
  const display=api+'attachments/'+firstFile.id+'/display-settings';const settings=(await request('quality',display)).body;await request('quality',display,'PATCH',{revision:settings.revision,pageRotations:{1:90}});await request('quality',display,'PATCH',{revision:settings.revision,pageRotations:{1:180}},409);
  const corrected=await sharp((await request('quality',display+'?download=1')).bytes).metadata();assert.equal(corrected.width,1250);assert.equal(corrected.height,900);
  const ids=r.attachments.map(f=>f.id);r=(await request('quality',api+'records/'+r.id,'PATCH',{action:'REORDER_ATTACHMENTS',version:r.version,attachmentIds:[...ids].reverse(),reason:'调整页序'})).data;assert.equal(r.attachments[0].id,ids[1]);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load((await request('quality',api+'paper-export?'+query())).bytes);const sheet=workbook.getWorksheet('日期报表');assert.equal(sheet.rowCount,3);assert.equal(sheet.getRow(3).getCell(5).value,'2001-01-05');
  const zip=await JSZip.loadAsync((await request('quality',api+'paper-export?'+query({format:'zip'}))).bytes);const photos=Object.values(zip.files).filter(f=>f.name.endsWith('.png'));assert.equal(photos.length,2);assert.ok(photos.every(f=>f.name.includes('2001-01-03/')));for(const f of photos)assert.deepEqual(await f.async('nodebuffer'),png);
  r=(await request('quality',api+'records/'+r.id,'DELETE',{version:r.version,reason:'回收站验收'})).data;assert.equal((await list()).total,0);assert.equal((await list({deleted:'1'})).total,1);await request('quality',api+'attachments/'+firstFile.id+'/content','GET',undefined,404);
  r=(await request('quality',api+'records/'+r.id,'PATCH',{action:'RESTORE',version:r.version,reason:'恢复验收'})).data;assert.equal(r.attachments.length,2);
  if(type==='FIRST'){const redirect=await request('quality','/quality-capture/'+fixture.orders[0].publicCode+'?type=FIRST','GET',undefined,307);assert.equal(redirect.response.headers.get('location'),'/workspace/quality/data?type=FIRST');}
  await request('quality','/workspace/quality/data?type='+type+'&recordId='+r.id);
  const evidence={passed:true,type,checks:checks.length,recordId:r.id,firstUpload:before.activity.firstUploadedAt,lastUpload:after.activity.lastUploadedAt,results:checks};await fs.writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,type,checks:checks.length,recordId:r.id}));
}
