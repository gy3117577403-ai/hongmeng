import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import assert from 'node:assert/strict';
const origin=process.env.IMPORT_QA_BASE||'http://127.0.0.1:3000',dir=process.env.IMPORT_QA_OUTPUT||'output/playwright/import-association';
if(process.env.IMPORT_QA_ALLOW!=='disposable-import-runtime'||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Disposable loopback runtime required');
const fixture=JSON.parse(readFileSync(dir+'/fixture.json','utf8'));mkdirSync(dir,{recursive:true});
function cli(args){const r=spawnSync('npx',['--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=import-association',...args],{encoding:'utf8',timeout:240000});const out=((r.stdout||'')+(r.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(fixture.password,'[disposable-password]');if(args[0]==='run-code')writeFileSync(dir+'/browser-runtime.txt',out);if(r.status||r.error||/### Error/.test(out))throw Error(r.error?.message||out);return out;}
try{
 cli(['open',origin+'/login']);
 const code=`async page=>{
  const f=${JSON.stringify(fixture)},origin=${JSON.stringify(origin)},dir=${JSON.stringify(dir)},checks=[],errors=[],failures=[];
  const check=(ok,label)=>{if(!ok)failures.push(label);else checks.push(label)};page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));
  const shot=async name=>{await page.mouse.move(0,0);await page.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});};
  let apiCookie='';
  const api=async(path,method='GET',data)=>{const r=await page.request.fetch(origin+path,{method,headers:{Origin:origin,Cookie:apiCookie},data});return {status:r.status(),body:await r.json().catch(()=>null)};};
  const login=async role=>{await page.context().clearCookies();apiCookie='';const r=await page.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:f.users[role].username,password:f.password}});check(r.status()===200,role+' login');apiCookie=(r.headers()['set-cookie']||'').match(/hm_session=[^;]+/)?.[0]||'';check(!!apiCookie,role+' session issued');};
  const geometry=async dialog=>{const r=await dialog.boundingBox(),footer=await dialog.locator(':scope > footer').boundingBox();check(r&&footer&&r.height<=page.viewportSize().height&&footer.y+footer.height<=page.viewportSize().height,'dialog and fixed actions fit viewport');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'no page horizontal overflow');};
  try{
   // Reconciliation may legitimately report differences in the shared release fixture.
   // The import entry's enabled state is the loading guard; click waits for it.
   await page.setViewportSize({width:1366,height:1024});await login('plan');await page.goto(origin+'/weekly-plan-center');
   await page.locator('summary').filter({hasText:'导入/导出'}).click();await page.getByRole('button',{name:'导入本周清单',exact:true}).click();
   let dialog=page.getByRole('dialog',{name:'批量导入量产计划',exact:true});await dialog.waitFor();await dialog.locator('input[type=file]').setInputFiles(f.massPath);
   await dialog.locator('tbody tr').nth(15).waitFor();check(await dialog.locator('tbody tr').count()===16,'all mass rows previewed');
   check(!(await dialog.innerText()).includes('是否需要治具'),'fixture choice removed from mass import');
   check(await dialog.locator('tbody tr').first().getByRole('combobox').inputValue()==='new','same specification prior order does not force continuation');
   check((await dialog.locator('tbody tr').first().innerText()).includes('SOP 2'),'actual SOP count is not capped at one');
   await geometry(dialog);await shot('01-mass-import-1366');
   await dialog.locator('tbody tr').first().getByRole('button',{name:'预览',exact:true}).click();
   let picker=page.getByRole('dialog',{name:'预览图纸资料',exact:true});await picker.waitFor();
   await picker.locator('canvas').first().waitFor();check(await picker.locator('canvas').first().evaluate(c=>c.width>100&&c.height>100),'actual stored PDF renders for plan-only account');
   await picker.getByRole('button',{name:'SOP 2',exact:true}).click();await picker.getByRole('combobox',{name:'预览资料文件'}).selectOption(f.files[2].id);await picker.locator('canvas').first().waitFor();
   await shot('02-drawing-preview-1366');await page.setViewportSize({width:1536,height:1024});await shot('02b-drawing-preview-reference-size');await page.setViewportSize({width:1366,height:1024});await picker.getByRole('button',{name:'返回导入',exact:true}).click();await picker.waitFor({state:'hidden'});
   check(await dialog.locator('tbody tr').count()===16,'closing preview preserves import rows');
   await dialog.locator('tbody tr').first().getByRole('button',{name:'更换',exact:true}).click();picker=page.getByRole('dialog',{name:'关联图纸资料库',exact:true});await picker.waitFor();
   const searchResponse=page.waitForResponse(r=>r.url().includes('/api/planning/import/drawings?')&&r.url().includes('q=D010240&')&&r.ok());await picker.getByRole('textbox',{name:'搜索图纸资料规格'}).fill('D010240');await searchResponse;
   check(await picker.getByRole('button',{name:'确认关联此档案'}).isEnabled(),'exact archive can be confirmed');await page.setViewportSize({width:1536,height:1024});await shot('02c-drawing-selection-reference-size');await page.setViewportSize({width:1366,height:1024});await picker.getByRole('button',{name:/D010240-8417-V09/}).click();check(await picker.getByRole('button',{name:'确认关联此档案'}).isDisabled(),'similar revision is preview-only');await picker.getByRole('button',{name:'取消',exact:true}).click();
   const ambiguous=dialog.locator('tbody tr').nth(3);await ambiguous.getByRole('button',{name:'选择已有资料',exact:true}).click();picker=page.getByRole('dialog',{name:'关联图纸资料库',exact:true});
   await picker.getByRole('button',{name:'确认关联此档案'}).waitFor();await picker.getByRole('button',{name:'确认关联此档案'}).click();await picker.waitFor({state:'hidden'});
   check(await dialog.getByRole('button',{name:'确认导入 16 行',exact:true}).isEnabled(),'explicit archive choice resolves ambiguity');
   await page.setViewportSize({width:1366,height:768});await geometry(dialog);await shot('03-mass-short-tablet');
   await page.setViewportSize({width:1536,height:1024});await shot('04-mass-reference-size');
   const committedPromise=page.waitForResponse(r=>r.url().endsWith('/api/planning/import/commit')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'确认导入 16 行',exact:true}).click();
   const committed=await(await committedPromise).json();check(committed.summary?.created===16,'mass UI commits 16 batches');
   dialog=page.getByRole('dialog',{name:'批量导入完成',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'完成并查看计划',exact:true}).click();await dialog.waitFor({state:'hidden'});
   await page.getByText(f.specs[0],{exact:true}).first().waitFor();check(await page.getByText(f.specs[0],{exact:true}).count()>0,'mass completion shows imported plan');
   const fresh=await api('/api/planning/import/drawings?customer='+encodeURIComponent(f.customer)+'&q='+encodeURIComponent(f.specs[1]));check(fresh.status===200&&fresh.body?.items?.length===1,'new plan creates one connected archive: '+JSON.stringify(fresh));
   await page.goto(origin+'/weekly-plan-center?branch=samples');await page.getByRole('region',{name:'样品计划表'}).waitFor();
   await page.locator('summary').filter({hasText:'导入 / 导出'}).click();await page.getByRole('button',{name:'批量导入',exact:true}).click();
   dialog=page.getByRole('dialog',{name:'批量导入样品计划',exact:true});await dialog.waitFor();await dialog.getByLabel('选择样品计划文件').setInputFiles(f.samplePath);await dialog.getByRole('button',{name:'读取并预览',exact:true}).click();
   await dialog.locator('tbody tr').nth(1).waitFor();check((await dialog.locator('tbody tr').first().innerText()).includes('1.042 h'),'sample 12.5 minutes x 5 uses single-set time');check((await dialog.locator('tbody tr').nth(1).innerText()).includes('工时待补'),'missing sample time is unknown');
   await dialog.locator('tbody tr').first().getByRole('button',{name:'预览',exact:true}).click();picker=page.getByRole('dialog',{name:'预览图纸资料',exact:true});await picker.locator('canvas').first().waitFor();await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});check(await dialog.isVisible(),'Escape closes only archive preview');
   await geometry(dialog);await shot('05-sample-reference-size');const samplePromise=page.waitForResponse(r=>r.url().endsWith('/api/sample-tasks/import/commit')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'确认导入 2 行',exact:true}).click();const sample=await(await samplePromise).json();check(sample.createdTaskCount===2&&sample.blockedCount===0,'sample UI imports both branches');
   dialog=page.getByRole('dialog',{name:'样品计划导入结果',exact:true});
   const receiptPromise=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/sample-tasks'&&u.searchParams.get('importBatch')===sample.batchId&&r.ok();});
   await dialog.getByRole('button',{name:'查看本次导入 2 项',exact:true}).click();await page.locator('.spr-batch-banner').waitFor();
   const receipt=await(await receiptPromise).json(),expectedIds=sample.rows.map(r=>r.taskId).sort(),receiptIds=(receipt.tasks||[]).map(t=>t.id).sort();
   const expectedTitles=(receipt.tasks||[]).map(t=>t.specification+' · '+(t.sourceOrderNo||t.code));
   await page.waitForFunction(titles=>{const table=document.querySelector('.spr-table'),models=[...(table?.querySelectorAll('tbody .sp-model')||[])];return table?.getAttribute('aria-busy')==='false'&&models.length===titles.length&&titles.every(title=>models.some(model=>model.getAttribute('title')===title));},expectedTitles);
   check(expectedIds.length===2&&JSON.stringify(receiptIds)===JSON.stringify(expectedIds),'sample receipt locates all imported rows');
   await login('reader');const read=await api('/api/planning/import/drawings?customer='+encodeURIComponent(f.customer));check(read.status===200,'readonly can inspect archives');const denied=await api('/api/planning/import/commit','POST',{batchId:'forbidden'});check(denied.status===403,'readonly cannot import');
   await login('tech');const techRead=await api('/api/planning/import/drawings?customer='+encodeURIComponent(f.customer));check(techRead.status===200,'sample technical account can inspect import archives');
   const foreign=techRead.body?.items?.find(i=>i.id===f.foreign.id);check(techRead.status===200&&!foreign,'other customer archive excluded');const removed=await api('/api/planning/import/drawings/files/missing/content');check(removed.status===404,'missing file rejected');
   check(errors.length===0,'no uncaught browser errors');if(failures.length)throw Error(JSON.stringify({failures,checks}));return {ok:true,checks,committed,sample};
  }catch(e){await shot('failure').catch(()=>{});const state=await page.locator('body').innerText();throw Error(String(e)+'\\n'+JSON.stringify({checks,failures})+'\\n'+state.slice(-6500));}
 }`;
 writeFileSync(dir+'/browser.generated.cjs',code);const out=cli(['run-code','--filename',dir+'/browser.generated.cjs']);const match=out.match(/### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/),result=match&&JSON.parse(match[1].trim());if(!result?.ok)throw Error(out);writeFileSync(dir+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.checks.length,checks:result.checks}));
}finally{try{cli(['close']);}catch{}}

const db=new PrismaClient();
try {
 const original=await db.drawingLibraryItem.findUniqueOrThrow({where:{id:fixture.products[0].id},include:{files:true}});
 assert.equal(original.fixtureRequired,true);assert.equal(original.files.length,3);assert.ok(original.files.every(f=>f.isCurrent&&!f.deletedAt));
 const created=await db.drawingLibraryItem.findFirstOrThrow({where:{customerName:fixture.customer,specification:fixture.specs[1]}});assert.equal(created.fixtureRequired,null);
 const sample=await db.sampleTask.findFirstOrThrow({where:{drawingLibraryItemId:original.id,deletedAt:null}});assert.equal(sample.unitPlannedMilliseconds,750000);assert.equal(sample.sampleQuantity,5);
 const old=await db.productionPlanOrder.findUniqueOrThrow({where:{id:fixture.oldOrderId},include:{batches:true}});assert.equal(old.batches.length,0);assert.equal(old.planningUnitMilliseconds,90000);
 writeFileSync(dir+'/data-invariants.json',JSON.stringify({passed:7,checks:['existing fixture choice retained','three source files preserved','current source versions unchanged','new fixture decision remains unknown','sample single-set time saved','sample quantity saved','old same-spec order not silently continued']},null,2));
}finally {await db.$disconnect();}
