import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
if(process.env.SAMPLE_BRANCH_QA_ALLOW!=='disposable-sample-branches')throw Error('Disposable sample runtime required');
const origin=process.env.SAMPLE_BRANCH_QA_BASE||'http://127.0.0.1:3000';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Loopback only');
const fixture=JSON.parse(readFileSync(process.env.SAMPLE_PLAN_BROWSER_FIXTURE,'utf8'));
if(!fixture.marker?.startsWith('SBR-'))throw Error('Unexpected fixture');
const dir=process.env.SAMPLE_PLAN_BROWSER_OUTPUT||'output/playwright/sample-planning';mkdirSync(dir,{recursive:true});
const codeFile=join(dir,'browser.generated.cjs');
function cli(args){const result=spawnSync('npx',['--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=sample-planning',...args],{encoding:'utf8',timeout:240000});const output=((result.stdout||'')+(result.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(fixture.password,'[disposable-password]');if(result.status||result.error)throw Error(output||result.error.message);return output;}
try{
 cli(['open',origin+'/login']);writeFileSync(join(dir,'initial-snapshot.txt'),cli(['snapshot']));
 writeFileSync(codeFile,`async page=>{
 const f=${JSON.stringify(fixture)}, origin=${JSON.stringify(origin)},dir=${JSON.stringify(dir)};
 const checks=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const shot=async name=>page.screenshot({path:dir+'/'+name+'.png',fullPage:false,animations:'disabled'});
 const table=page.getByRole('region',{name:'样品计划表'});
 try{
  await page.setViewportSize({width:1366,height:1024});
  await page.goto(origin+'/login?next='+encodeURIComponent('/weekly-plan-center?branch=samples'));
  await page.getByLabel('员工编号 / 管理账号').fill(f.username);await page.getByLabel('密码',{exact:true}).fill(f.password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/weekly-plan-center'&&url.searchParams.get('branch')==='samples');
  await table.waitFor();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false');
  await page.locator('summary').filter({hasText:'导入 / 导出'}).click();await page.getByRole('button',{name:'批量导入',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'导入样品计划',exact:true});await dialog.waitFor();
  check(await dialog.locator('input[type=date]').inputValue()===f.week,'import inherits active planning week');
  await dialog.getByLabel('选择样品计划文件').setInputFiles(f.excelPath);await dialog.getByRole('button',{name:'读取并预览'}).click();
  dialog=page.getByRole('dialog',{name:'核对样品计划',exact:true});await dialog.waitFor();
  check(await dialog.locator('tbody tr').count()===24,'all spreadsheet rows shown before commit');
  check((await dialog.locator('tbody tr').first().textContent()).includes('合计 5 小时'),'12.5 minutes x 24 equals 5 hours in preview');
  check((await dialog.locator('tbody tr').last().textContent()).includes('老产品制作'),'explicit row branch wins');
  await shot('import-preview-1366');
  const commitResponse=page.waitForResponse(r=>r.url().includes('/api/sample-tasks/import/commit')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认导入',exact:true}).click();const committed=await (await commitResponse).json();
  check(committed.createdTaskCount===24&&committed.blockedCount===0,'UI commits all rows exactly once');
  dialog=page.getByRole('dialog',{name:'导入结果',exact:true});await dialog.waitFor();
  await dialog.locator('tbody tr').first().getByRole('button').click();
  const importedDetail=page.getByRole('dialog',{name:'样品试制',exact:true});await importedDetail.waitFor();
  check(await page.getByRole('dialog',{name:'导入结果',exact:true}).count()===0,'import results yield to the record detail');
  await importedDetail.getByRole('button',{name:/关闭/}).first().click();await importedDetail.waitFor({state:'detached'});
  await dialog.waitFor();check(await dialog.locator('tbody tr').count()===24,'closing imported record restores all import results');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出逐行结果'}).click();await (await download).saveAs(dir+'/import-results.csv');
  await dialog.getByRole('button',{name:'查看本次导入 24 项'}).click();await page.locator('.spr-batch-banner').waitFor();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false');
  check((await table.locator('.sp-table-summary').textContent()).includes('115'),'aggregate known hours includes every page and omits missing hours');
  check(await table.locator('.sp-table-summary').isVisible(),'quantity and hours summary is visible');
  check((await table.locator('.sp-table-footer').textContent()).includes('共 24 条'),'mixed branch import result includes all 24 plans');
  check(await table.locator('tbody tr').count()===20,'default page contains 20 rows');
  await table.getByRole('button',{name:'下一页计划'}).click();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false'&&document.querySelector('.sp-table-footer')?.textContent.includes('第 21–24 条'));
  const row=table.locator('tbody tr').first(),model=await row.locator('.sp-model').textContent();
  await row.locator('.sp-model').click();const detail=page.getByRole('dialog').last();await detail.waitFor();await shot('detail-1366');await detail.getByRole('button',{name:/关闭/}).first().click();await detail.waitFor({state:'detached'});
  check((await table.locator('.sp-table-footer').textContent()).includes('第 21–24 条'),'closing detail keeps page 2');check((await table.locator('tbody tr').first().textContent()).includes(model),'closing detail keeps original row');
  await table.getByLabel('每页条数').selectOption('50');await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.spr-table tbody tr').length===24);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'no whole page horizontal overflow at 1366');
  check(await page.getByLabel('选择任意计划周').isVisible(),'arbitrary planning week remains accessible on tablet');
  await shot('planning-1366');await page.setViewportSize({width:2048,height:1100});await shot('planning-2048');
  await page.getByRole('button',{name:/返回导入前视图/}).click();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false');
  await page.getByRole('navigation',{name:'计划周',exact:true}).getByRole('button',{name:'全部周',exact:true}).click();
  await page.getByRole('button',{name:/资料待处理/}).click();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false');
  check(await page.getByRole('navigation',{name:'计划周',exact:true}).getByRole('button',{name:'全部周',exact:true}).getAttribute('aria-pressed')==='true','changing status does not change week');
  await page.getByRole('button',{name:/历史已完成/}).click();await page.waitForFunction(()=>document.querySelector('.spr-table')?.getAttribute('aria-busy')==='false');
  check(await page.getByRole('navigation',{name:'计划周',exact:true}).getByRole('button',{name:'全部周',exact:true}).getAttribute('aria-pressed')==='true','history explicitly spans all planning weeks');
  check(await table.getByRole('columnheader',{name:'负责人'}).count()===0,'owner column stays removed');
  check(errors.length===0,'no uncaught browser errors');await shot('history-2048');
  return {ok:true,checks};
 }catch(e){await shot('failure').catch(()=>{});throw e;}
}`);
 const result=cli(['run-code','--filename',codeFile]);writeFileSync(join(dir,'browser-result.txt'),result);const section=result.match(/### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/);const acceptance=section?JSON.parse(section[1].trim()):null;if(acceptance?.ok!==true||!Array.isArray(acceptance.checks)||acceptance.checks.length<15)throw Error(result);console.log(result);
}finally{try{cli(['close']);}catch{}rmSync(codeFile,{force:true});}
