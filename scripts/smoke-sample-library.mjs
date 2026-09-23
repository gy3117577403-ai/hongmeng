import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
assert.equal(process.env.SAMPLE_LIBRARY_QA_ALLOW,'disposable-sample-library');
const base=process.env.SAMPLE_LIBRARY_QA_BASE||'http://127.0.0.1:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname),'Isolated local database only');
const db=new PrismaClient(),tag='SL-'+randomUUID().slice(0,8),checks=[],password='Codex-Mobile-Sample-2026!R',initial='Codex-Mobile-Start-2026!Z';let cookie='';
async function req(label,url,body,expected=200,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+url,{method,headers:{Cookie:cookie,Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const data=await response.json();assert.equal(response.status,expected,`${label}: ${JSON.stringify(data).slice(0,650)}`);if(url==='/api/auth/login')cookie=response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0]||'';checks.push({label,status:response.status});return data;
}
const check=(ok,label)=>{assert.ok(ok,label);checks.push({label});};
const login=(username,password)=>req('login disposable account','/api/auth/login',{username,password});
try {
 await req('anonymous library requires login','/api/sample-library',undefined,401);
 if(process.env.SAMPLE_LIBRARY_INITIAL_PASSWORD){await login(process.env.SEED_ADMIN_USERNAME,process.env.SAMPLE_LIBRARY_INITIAL_PASSWORD);await req('initialize isolated admin password','/api/auth/change-password',{currentPassword:process.env.SAMPLE_LIBRARY_INITIAL_PASSWORD,newPassword:process.env.SMOKE_ADMIN_CHANGED_PASSWORD,confirmPassword:process.env.SMOKE_ADMIN_CHANGED_PASSWORD});}
 await login(process.env.SEED_ADMIN_USERNAME,process.env.SMOKE_ADMIN_CHANGED_PASSWORD);const adminCookie=cookie;
 const catalog=await req('load department catalog','/api/users');const dept=catalog.departments.find(d=>d.code==='HR');assert.ok(dept);
 const employee=(await req('create mobile-only employee','/api/employees',{name:tag+'样品员工',departmentId:dept.id},201)).employee;
 const reader=(await req('grant independent sample-library read access','/api/users/module-access',{employeeId:employee.id,username:employee.employeeNo,displayName:employee.name,password:initial,accountStatus:'ACTIVE',modulePermissions:{},workbenchEnabled:false,fieldReportEnabled:false,sampleLibraryEnabled:true})).user;
 check(reader.accessMethods.sampleLibrary&&!reader.accessMethods.workbench,'library-only account has no workbench entry');
 const legacyEmployee=(await req('create legacy employee','/api/employees',{name:tag+'既有账号',departmentId:dept.id},201)).employee;
 const legacy=(await req('create legacy account','/api/users',{employeeId:legacyEmployee.id,username:legacyEmployee.employeeNo,displayName:legacyEmployee.name,password:initial,mustChangePassword:false,profileKey:'DEPARTMENT_FULL',departmentId:dept.id},201)).user;
 const oldGrants=legacy.accessGrants.filter(g=>g.isActive).map(g=>g.id).sort();
 const changed=(await req('add mobile permission without replacing legacy grants','/api/users/sample-library-access',{id:legacy.id,enabled:true,expectedUpdatedAt:legacy.updatedAt})).user;
 assert.deepEqual(changed.accessGrants.filter(g=>g.isActive&&g.profileKey!=='SAMPLE_LIBRARY_READER').map(g=>g.id).sort(),oldGrants);
 await req('stale independent grant save rejected','/api/users/sample-library-access',{id:legacy.id,enabled:false,expectedUpdatedAt:legacy.updatedAt},409);
 const storage=new S3Client({endpoint:process.env.S3_ENDPOINT||'http://127.0.0.1:19000',region:'auto',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#f4f0e6"/><rect x="55" y="55" width="1090" height="790" rx="15" fill="white" stroke="#a2b1ba"/><text x="90" y="110" font-size="26" fill="#203d51">D014503-8305-V01 / SAMPLE REFERENCE</text><path d="M180 480 C360 300 650 560 980 310" fill="none" stroke="#28353d" stroke-width="48"/><path d="M180 480 C360 300 650 560 980 310" fill="none" stroke="#f29434" stroke-width="8"/><rect x="100" y="430" width="110" height="110" rx="10" fill="#d3dce1" stroke="#52656e" stroke-width="5"/><rect x="955" y="260" width="100" height="100" rx="10" fill="#d3dce1" stroke="#52656e" stroke-width="5"/><path d="M160 610H1010M160 580V640M1010 580V640" stroke="#52656e" stroke-width="2"/><text x="460" y="655" font-size="24" fill="#52656e">6000 +/- 20 mm</text><text x="95" y="750" font-size="22" fill="#71818b">Inspection fixture photo / read-only sample archive</text><text x="95" y="797" font-size="18" fill="#c87635">Acceptance fixture - not production data</text></svg>';
 const image=await sharp(Buffer.from(svg)).jpeg({quality:90}).toBuffer(),objectKey='qa/sample-library/'+tag+'/photo.jpg';
 await storage.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET||'workorder-resources',Key:objectKey,Body:image,ContentType:'image/jpeg'}));
 const customer=tag+' · 杭州样品客户',otherCustomer=tag+' · 其他客户';
 async function product(specification,customerName=customer){return db.drawingLibraryItem.create({data:{customerName,productName:'控制线束 · 样品参考',specification,libraryKey:tag+'-'+randomUUID()}});}
 async function task(p,extra={}){return db.sampleTask.create({data:{code:tag+'-'+randomUUID().slice(0,6),qrCode:randomUUID(),drawingLibraryItemId:p.id,customerNameSnapshot:p.customerName,specificationSnapshot:p.specification,productNameSnapshot:p.productName,dataPurpose:'PRODUCTION',...extra}});}
 async function photo(t,extra={}){const key=objectKey+'-'+randomUUID();await storage.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET||'workorder-resources',Key:key,Body:image,ContentType:'image/jpeg'}));return db.samplePhoto.create({data:{taskId:t.id,category:'FINISHED',caption:'连接器与线束装配照片',originalName:'sample-reference.jpg',mimeType:'image/jpeg',size:image.length,objectKey:key,sha256:createHash('sha256').update(image).digest('hex'),...extra}});}
 const p=await product('D014503-8305-V01'),old=await task(p,{status:'COMPLETED',archivedAt:new Date(),unitPlannedMilliseconds:60000,updatedAt:new Date('2025-03-01')});
 const entry=await db.sampleDataEntry.create({data:{taskId:old.id,kind:'STRIPPING',label:'X21 连接器参数',payload:{model:'X21',outerPeelMm:99,innerPeelMm:5},submissionRevision:2,reviewStatus:'CHANGES_REQUESTED'}});
 const process=await db.sampleDataEntry.create({data:{taskId:old.id,kind:'PROCESS_TIME',payload:{processName:'连接器装配',recommendedSeconds:45,timeBasis:'per_unit'},submissionRevision:1,reviewStatus:'PUBLISHED'}});
 const first=await photo(old,{submissionRevision:2,reviewStatus:'PUBLISHED'}),second=await photo(old,{submissionRevision:1,reviewStatus:'PUBLISHED',caption:'连接器局部细节',category:'DETAIL'});
 const snapshot={entries:[{id:entry.id,kind:entry.kind,label:entry.label,payload:{model:'X21',outerPeelMm:3.5,innerPeelMm:5}},{id:process.id,kind:process.kind,payload:process.payload}],photos:[{id:first.id,category:'FINISHED',caption:'连接器与线束装配照片'},{id:second.id,category:'DETAIL',caption:'连接器局部细节'}]};
 await db.sampleSubmission.create({data:{taskId:old.id,revision:1,mutationId:randomUUID(),requestHash:'qa',status:'CONFIRMED',snapshot,reviewedSnapshot:snapshot,submittedAt:new Date('2025-03-01')}});
 await db.sampleSubmission.create({data:{taskId:old.id,revision:2,mutationId:randomUUID(),requestHash:'qa2',status:'REJECTED',snapshot:{entries:[{id:entry.id,kind:entry.kind,payload:{model:'X21',outerPeelMm:99}}],photos:[{id:first.id,category:'FINISHED'}]},decisionComment:'参数需要核对',submittedAt:new Date('2026-09-20')}});
 const current=await task(p,{status:'IN_PROGRESS'});await db.sampleDataEntry.create({data:{taskId:current.id,kind:'NOTICE',payload:{content:'新一轮未审核记录'},reviewStatus:'DRAFT'}});
 const emptyRepeat=await task(p,{taskType:'REPEAT',status:'PLANNED'});
 const other=await product(p.specification,otherCustomer);await photo(await task(other));
 for(let i=0;i<14;i++){const item=await product(i===0?'D014503-8305-V010':`G014503-${String(i).padStart(4,'0')}-V01`);const t=await task(item);if(i%2===0)await photo(t);else await db.sampleDataEntry.create({data:{taskId:t.id,kind:'STRIPPING',payload:{model:'DF3-2P',outerPeelMm:10}}});}
 const sectionProduct=await product('DRAFT-ONLY-001'),sectionTask=await task(sectionProduct);await db.sampleDraftSection.create({data:{taskId:sectionTask.id,kind:'STRIPPING',payload:{rows:[{rowId:'empty'},{rowId:'meaningful',model:'X11',innerPeelMm:'5'}]}}});
 const excluded=[];for(const [purpose,deleted] of [['TEST',false],['TRAINING',false],['PRODUCTION',true]]){const item=await product('EXCLUDED-'+purpose),t=await task(item,{dataPurpose:purpose,...(deleted?{deletedAt:new Date()}:{})});excluded.push({product:item.id,photo:(await photo(t)).id});}
 const removed=await photo(current,{deletedAt:new Date()});
 await login(reader.username,initial);await req('first mobile login changes password','/api/auth/change-password',{currentPassword:initial,newPassword:password,confirmPassword:password});await login(reader.username,password);const mobileCookie=cookie;
 const me=(await req('mobile effective permissions','/api/me')).user;check(me.access.sampleLibraryEnabled,'mobile entitlement resolves');check(!me.access.capabilities.includes('PRODUCTION:UPDATE'),'no production mutation capability');
 const list=await req('list history independent of plan weeks','/api/sample-library?customer='+encodeURIComponent(customer));check(list.total===16,'all product groups including draft-only records');check(list.items.length===12,'first page bounded to 12 cards');
 check(!JSON.stringify(list).includes('outerPeelMm'),'listing contains no heavy data payloads');
 const exact=await req('fuzzy normalized model search','/api/sample-library?q=d014503%208305&customer='+encodeURIComponent(customer));check(exact.total===2,'fragment search matches exact and prefix');
 const ranked=await req('exact model is first','/api/sample-library?q=D0145038305V01&customer='+encodeURIComponent(customer));check(ranked.items[0].id===p.id,'exact match precedes prefix');
 const both=await req('same model different customers stays separate','/api/sample-library?q=D0145038305V01');check(both.items.some(row=>row.id===p.id)&&both.items.some(row=>row.id===other.id),'customer identities not merged');
 const detail=await req('load archived completed sample','/api/sample-library/'+p.id);check(detail.defaultKey===old.id+':1','approved old version wins over newer draft and empty repeat');check(!detail.histories.some(row=>row.taskId===emptyRepeat.id),'empty repeat does not displace historical reference');
 const source=await req('load coherent immutable version','/api/sample-library/'+p.id+'?source='+encodeURIComponent(detail.defaultKey));check(source.entries.find(row=>row.id===entry.id).payload.outerPeelMm===3.5,'uses frozen approved parameter not current rejected value');check(source.photos.length===2,'snapshot photos stay visible after later submission');
 const rejected=await req('explicit rejected history','/api/sample-library/'+p.id+'?source='+encodeURIComponent(old.id+':2'));check(rejected.comment==='参数需要核对'&&rejected.entries[0].payload.outerPeelMm===99,'rejected history is separate and labelled');
 const draftDetail=await req('unsubmitted section data discoverable','/api/sample-library/'+sectionProduct.id);const draft=await req('load meaningful unsubmitted rows','/api/sample-library/'+sectionProduct.id+'?source='+encodeURIComponent(draftDetail.defaultKey));check(draft.entries.length===1&&draft.entries[0].payload.model==='X11','blank placeholders removed without losing saved draft');
 const pixels=await fetch(base+'/api/sample-library/photos/'+first.id+'?size=thumb',{headers:{Cookie:cookie}});assert.equal(pixels.status,200);const thumbnail=Buffer.from(await pixels.arrayBuffer()),metadata=await sharp(thumbnail).metadata();check(metadata.width<=440&&metadata.height<=440&&thumbnail.length<image.length,'authorized thumbnail is resized');
 for(const item of excluded){await req('excluded media is not readable','/api/sample-library/photos/'+item.photo,undefined,404);const value=await req('excluded source not listed in detail','/api/sample-library/'+item.product);check(value.histories.length===0,'test training deleted task history absent');}
 await req('deleted photo cannot be read','/api/sample-library/photos/'+removed.id,undefined,404);
 for(const url of ['/api/sample-tasks','/api/drawing-library/missing/files/upload','/api/employees','/api/users/sample-library-access'])await req('mobile reader cannot mutate '+url,url,{},403);
 await req('mobile reader cannot read HR','/api/employees',undefined,403);
 cookie='';await req('QR is not a public media token','/api/sample-library/photos/'+first.id,undefined,401);
 cookie=adminCookie;
 const fresh=(await req('load current mobile account version','/api/users')).users.find(user=>user.id===reader.id);
 const revoked=(await req('revoke mobile entitlement','/api/users/sample-library-access',{id:reader.id,enabled:false,expectedUpdatedAt:fresh.updatedAt})).user;
 cookie=mobileCookie;await req('revocation invalidates old cookie','/api/sample-library',undefined,403);
 cookie=adminCookie;await req('restore mobile fixture for browser','/api/users/sample-library-access',{id:reader.id,enabled:true,expectedUpdatedAt:revoked.updatedAt});
 const fixture={marker:tag,username:reader.username,password,adminUsername:process.env.SEED_ADMIN_USERNAME,adminPassword:process.env.SMOKE_ADMIN_CHANGED_PASSWORD,productId:p.id,model:p.specification,customer,otherCustomer,taskCode:current.qrCode,oldKey:old.id+':1',rejectedKey:old.id+':2'};
 const fixturePath=process.env.SAMPLE_LIBRARY_FIXTURE||'/tmp/sample-library-fixture.json';await fs.mkdir(path.dirname(fixturePath),{recursive:true});await fs.writeFile(fixturePath,JSON.stringify(fixture));
 const output=process.env.SAMPLE_LIBRARY_QA_OUTPUT||'artifacts/sample-library/http.json';await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({ok:true,marker:tag,checks},null,2));console.log(`Sample library HTTP acceptance: ${checks.length} checks passed`);
} finally {await db.$disconnect();}
