import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// Browser acceptance is allowed only against a throwaway loopback runtime.
if (process.env.MATERIAL_COLLAB_QA_ALLOW !== 'disposable-material-runtime') throw Error('Disposable material collaboration runtime guard required');
const origin = process.env.MATERIAL_COLLAB_QA_BASE || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Loopback runtime required');
if (!process.env.MATERIAL_COLLAB_QA_FIXTURE) throw Error('Disposable fixture path required');
const fixture = JSON.parse(readFileSync(process.env.MATERIAL_COLLAB_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
if (!fixture.marker?.startsWith('mat-collab-') || !fixture.warehouseTaskId) throw Error('Unexpected fixture');
const dir = process.env.MATERIAL_COLLAB_QA_OUTPUT || 'artifacts/material-collaboration';
mkdirSync(dir, { recursive: true });
const codeFile = join(dir, 'browser-code.generated.cjs');

function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=material-collaboration-release', ...args], { encoding: 'utf8', timeout: 180000 });
  const output = ((result.stdout || '') + (result.stderr || ''))
    .replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '')
    .replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}

try {
  const code = `async page => {
    const origin=${JSON.stringify(origin)}, f=${JSON.stringify(fixture)}, dir=${JSON.stringify(dir)};
    const checks=[], errors=[];
    page.on('pageerror', error => errors.push(String(error)));
    const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label)};
    // API assertions run only after the target workbench has rendered. They
    // use the same browser session as the business UI under test.
    const api=async(path,method='GET',data)=>page.evaluate(async input=>{
      const response=await fetch(input.path,{method:input.method,headers:{'content-type':'application/json'},body:input.data?JSON.stringify(input.data):undefined});
      return {status:response.status,body:await response.json().catch(()=>({}))};
    },{path,method,data});
    const shot=async name=>page.screenshot({path:dir+'/'+name+'.png',fullPage:false});
    const login=async(kind,target)=>{
      await page.context().clearCookies();
      await page.goto(origin+'/login?next='+encodeURIComponent(target));
      await page.getByLabel('员工编号 / 管理账号').fill(f.users[kind].username);
      await page.getByLabel('密码',{exact:true}).fill(f.password);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      // Login navigates with location.href. Wait for that exact destination so a
      // pending post-login redirect cannot override the next smoke-test action.
      const expectedPath=target.split('?')[0];
      const expectedTaskId=target.match(/[?&]taskId=([^&]+)/)?.[1];
      // The warehouse normalizes its default status with history.replaceState.
      await page.waitForURL(url=>url.pathname===expectedPath&&(!expectedTaskId||url.searchParams.get('taskId')===expectedTaskId),{timeout:30000});
      await page.waitForLoadState('domcontentloaded');
    };
    try {
      await page.setViewportSize({width:1366,height:1024});
      const initial='/workspace/warehouse?taskId='+encodeURIComponent(f.warehouseTaskId)+'&status=pending';
      await login('warehouse',initial);
      await page.getByRole('button',{name:'登记缺料 / 异常'}).waitFor();
      // The detail and queue load independently; the detail action can appear
      // before the week-scoped list and its reconciliation finish.
      await page.locator('.mw-ui-order.active').waitFor({timeout:30000});
      check((await page.locator('.mw-ui-order.active').textContent()).includes(f.workOrder.specification),'warehouse selected pending order');
      await page.getByRole('button',{name:'登记缺料 / 异常'}).click();
      const dialog=page.getByRole('dialog',{name:'登记物料异常'});
      await dialog.getByRole('button',{name:'采购物料缺料'}).click();
      await dialog.locator('textarea').first().fill('隔离验收：端子尚缺五个，等待采购到料');
      const material=f.marker+'-TERM-A';
      await dialog.getByPlaceholder('请输入缺料物料的型号').fill(material);
      await dialog.getByPlaceholder('数量待确认').fill('5');
      await dialog.getByRole('button',{name:'保存',exact:true}).click();
      await dialog.waitFor({state:'detached'});
      await page.waitForFunction(id=>new URL(location.href).searchParams.get('taskId')===id&&new URL(location.href).searchParams.get('status')==='pending',f.warehouseTaskId);
      await page.locator('.mg-material-row').filter({hasText:material}).waitFor();
      check(await page.evaluate(()=>location.pathname)==='/workspace/warehouse','register stays in warehouse page');
      check(await page.getByRole('heading',{name:f.workOrder.specification}).count()===1,'same warehouse order remains selected after leaving pending filter');
      const warehouse=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId);
      check(warehouse.status===200&&warehouse.body.task.status==='exception','registered exception persists on same task');
      const event=warehouse.body.task.activeExceptions?.find(item=>item.materialModel===material);
      check(Boolean(event?.followUpId&&event.supplySource==='PURCHASED'&&event.shortageQuantity===5),'one purchased shortage creates linked follow-up');
      const followId=event.followUpId;
      const openQueue=(await api('/api/warehouse/material-tasks?scope=open&status=active&keyword='+encodeURIComponent(f.marker))).body;
      check(openQueue.tasks.some(task=>task.id===f.warehouseTaskId),'default incomplete queue includes shortage orders');
      check(openQueue.summary.exception===1&&openQueue.pagination.total===1,'server counters respect the same keyword scope');
      const unassigned=(await api('/api/warehouse/material-tasks?scope=open&status=unassigned&keyword='+encodeURIComponent(f.marker))).body;
      check(unassigned.pagination.total===(event.owner?0:1),'unassigned queue reflects real ownership');

      await shot('warehouse-registered-1366x1024');
      await page.locator('.mg-material-row').filter({hasText:material}).getByRole('button',{name:'查看 / 跟进'}).click();
      const sheet=page.getByRole('dialog',{name:'物料协同处理'});
      await sheet.getByRole('heading',{name:material,exact:true}).waitFor({timeout:30000});
      check(await page.evaluate(()=>location.pathname)==='/workspace/warehouse','case processing opens in place without navigation');
      await shot('follow-up-in-warehouse-sheet');
      await sheet.getByRole('button',{name:'关闭物料跟进'}).click();
      await sheet.waitFor({state:'detached'});
      const returnTo=await page.evaluate(()=>location.pathname+location.search);
      check(returnTo.includes('taskId='+encodeURIComponent(f.warehouseTaskId))&&returnTo.includes('status=pending'),'close sheet preserves original warehouse filters');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2&&document.documentElement.scrollHeight<=innerHeight+2),'warehouse panels fit one viewport');
      const followPath='/workspace/procurement?taskId='+encodeURIComponent(followId)+'&returnTo='+encodeURIComponent(returnTo);
      const waitFollowSelection=async()=>{
        await page.locator('.mf-order.active').filter({hasText:material}).waitFor({timeout:30000});
        await page.getByRole('heading',{name:material,exact:true}).waitFor({timeout:30000});
      };
      await login('ordinary',followPath);
      await waitFollowSelection();
      await page.getByLabel('本次进展',{exact:true}).fill('隔离验收：已确认供方今晚发出五个端子');
      const noteResponse=page.waitForResponse(response=>response.url().includes('/api/material-follow-ups/'+followId)&&response.request().method()==='PATCH');
      await page.getByRole('button',{name:'保存进展',exact:true}).click();
      check((await noteResponse).status()===200,'ordinary logged-in user may save textual progress');
      const followed=await api('/api/material-follow-ups/'+followId);
      check(followed.body.task.latestProgress.includes('今晚发出'),'ordinary progress persists');
      check(followed.body.task.activities.some(activity=>activity.actor?.id===f.users.ordinary.id&&activity.createdAt),'progress keeps author and timestamp');
      check(await page.getByRole('button',{name:'更新交期 / 到料',exact:true}).count()===0,'ordinary user cannot edit controlled fields');
      const forged=await api('/api/material-follow-ups/'+followId,'PATCH',{action:'note',version:followed.body.task.version,note:'夹带字段',receivedQuantity:5});
      check(forged.status===400,'ordinary note rejects controlled-field smuggling');
      await page.locator('.mf-latest p').filter({hasText:'今晚发出'}).waitFor();
      await shot('follow-up-progress-1366x1024');

      await login('warehouse',returnTo);
      await page.locator('.mg-material-row').filter({hasText:material}).waitFor({timeout:30000});
      const warehouseAfterNote=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId);
      check(warehouseAfterNote.status===200,'warehouse user can read its material task');
      check(warehouseAfterNote.body.task.activities.some(activity=>activity.content?.includes('今晚发出')&&activity.actor?.id===f.users.ordinary.id),'warehouse reads the same authored progress');
      await page.getByRole('button',{name:'处理记录'}).click();
      const warehouseProgress=page.locator('.ms-timeline article').filter({hasText:'今晚发出'});
      await warehouseProgress.waitFor();
      check((await warehouseProgress.textContent()).includes(f.users.ordinary.displayName),'warehouse timeline shows ordinary author');
      await shot('warehouse-progress-1366x1024');

      await login('operator',followPath);
      await waitFollowSelection();
      await page.getByRole('button',{name:'更新交期 / 到料',exact:true}).click();
      const fields=page.locator('.mf-advanced-fields');
      const eta=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
      await fields.locator('label').filter({hasText:'跟进状态'}).locator('select').selectOption('WAITING_ARRIVAL');
      await fields.getByLabel('预计到料日期').fill(eta);
      await fields.getByLabel('累计已到数量').fill('3');
      await page.getByLabel('本次进展',{exact:true}).fill('隔离验收：已先到三件，剩余两件继续催交');
      const partialResponse=page.waitForResponse(response=>response.url().includes('/api/material-follow-ups/'+followId)&&response.request().method()==='PATCH');
      await page.getByRole('button',{name:'保存进展与处理'}).click();
      check((await partialResponse).status()===200,'operator records partial arrival');
      const partial=(await api('/api/material-follow-ups/'+followId)).body.task;
      check(partial.status==='WAITING_ARRIVAL'&&partial.exceptionCase.receivedQuantity===3,'partial arrival remains open');
      const premature=await api('/api/material-follow-ups/'+followId,'PATCH',{action:'update',version:partial.version,ownerId:f.users.operator.id,status:'WAITING_WAREHOUSE',receivedQuantity:3,expectedAt:eta,note:'错误地要求仓库确认'});
      check(premature.status===400,'partial arrival cannot enter warehouse verification');

      await login('warehouse',returnTo);
      await page.locator('.mg-material-row').filter({hasText:material}).waitFor({timeout:30000});
      const warehousePartial=(await api('/api/warehouse/material-tasks/'+f.warehouseTaskId)).body.task;
      const prematureClose=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId,'PATCH',{action:'resolve',version:warehousePartial.version,exceptionId:event.id,note:'未到齐不能关闭',resolution:'pending'});
      check(prematureClose.status===409,'warehouse cannot close shortage before full arrival');

      await login('operator',followPath);
      await waitFollowSelection();
      const full=await api('/api/material-follow-ups/'+followId,'PATCH',{action:'update',version:partial.version,ownerId:f.users.operator.id,status:'WAITING_WAREHOUSE',receivedQuantity:5,expectedAt:eta,note:'五件端子全部到齐，交仓库核验'});
      check(full.status===200&&full.body.task.status==='WAITING_WAREHOUSE','full arrival enters warehouse confirmation');
      const waiting=(await api('/api/warehouse/material-tasks?scope=open&status=waiting&keyword='+encodeURIComponent(f.marker))).body;
      check(waiting.pagination.total===1&&waiting.summary.waiting===1,'reported arrival appears in warehouse verification queue');

      await page.reload();
      const back=page.getByRole('link',{name:/返回对应仓库工单/});
      await back.waitFor();
      check((await back.getAttribute('href')).includes('taskId='+encodeURIComponent(f.warehouseTaskId)),'return action targets original warehouse work order');
      await back.click();
      await page.waitForURL(url=>url.pathname==='/workspace/warehouse'&&url.searchParams.get('taskId')===f.warehouseTaskId);
      await page.getByRole('heading',{name:f.workOrder.specification}).waitFor({timeout:30000});
      check(await page.getByRole('heading',{name:f.workOrder.specification}).count()===1,'return opens the same warehouse work order');

      await login('warehouse',returnTo);
      await page.locator('.mg-material-row').filter({hasText:material}).getByRole('button',{name:'核对到料'}).click();
      const verify=page.getByRole('dialog',{name:'确认本项异常解决'});
      await verify.locator('textarea').fill('现场已清点五件端子，实物与型号一致');
      check(await verify.getByRole('button',{name:'核对完成，确认解决'}).isDisabled(),'physical verification needs explicit check');
      await verify.getByRole('checkbox').check();
      await verify.getByRole('button',{name:'核对完成，确认解决'}).click();
      await verify.waitFor({state:'detached'});
      const resolved=(await api('/api/material-follow-ups/'+followId)).body.task;
      check(resolved.status==='RESOLVED'&&resolved.exceptionCase.status==='RESOLVED','warehouse physical verification closes same issue');
      await page.getByRole('button',{name:'完成配料'}).click();
      const complete=page.getByRole('dialog',{name:'确认工单物料已配齐'});
      await complete.getByRole('checkbox').check();
      await complete.getByRole('button',{name:'确认配齐',exact:true}).click();
      await complete.waitFor({state:'detached'});
      await page.getByText('该工单已确认配齐',{exact:true}).waitFor();
      check((await page.evaluate(()=>location.pathname+location.search))===returnTo,'completion preserves the selected work order and original queue');
      check((await api('/api/warehouse/material-tasks/'+f.warehouseTaskId)).body.task.status==='completed','warehouse task is completed');
      await shot('warehouse-closed-1366x1024');
      check(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2),'no document scrolling at tablet size');
      await page.setViewportSize({width:1920,height:1080});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2&&document.documentElement.scrollHeight<=innerHeight+2),'one-page desktop layout');
      await shot('warehouse-desktop-1920x1080');
      await page.setViewportSize({width:1366,height:1024});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'1366 tablet has no page-level horizontal overflow');
      // Separate visual fixtures keep the closure scenario and its count assertions isolated.
      await login('warehouse','/workspace/warehouse?taskId='+encodeURIComponent(f.visual.warehouseTaskId));
      await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
      await page.locator('.mg-material-row').nth(2).waitFor();
      await page.locator('.mw-ui-order').nth(8).waitFor();
      const overdueQueue=(await api('/api/warehouse/material-tasks?scope=open&status=active&expected=overdue&keyword='+encodeURIComponent(f.visual.marker))).body;
      check(overdueQueue.pagination.total>0&&overdueQueue.summary.waiting===0&&overdueQueue.summary.unassigned===0,'overdue counters retain the same queue filters');
      await shot('warehouse-glass-1366x1024');
      const queueScroll=await page.locator('.mg-queue .ms-list').evaluate(el=>{el.scrollTop=240;return el.scrollTop});
      check(queueScroll>0&&await page.evaluate(()=>scrollY===0),'queue scroll is independent from the document');
      await page.locator('.mg-queue .ms-list').evaluate(el=>{el.scrollTop=0});
      await page.locator('.mg-material-row').filter({hasText:f.visual.materialModel}).getByRole('button',{name:'查看 / 跟进'}).click();
      const visualSheet=page.getByRole('dialog',{name:'物料协同处理'});
      await visualSheet.getByRole('heading',{name:f.visual.materialModel,exact:true}).waitFor();
      await shot('material-glass-sheet-1366x1024');
      await visualSheet.getByLabel('本次进展',{exact:true}).fill('未保存的跟进草稿');
      await visualSheet.getByRole('button',{name:'关闭物料跟进'}).click();
      const discard=page.getByRole('alertdialog',{name:'保留这次未保存的进展？'});
      await discard.waitFor();
      await shot('material-glass-unsaved-1366x1024');
      await discard.getByRole('button',{name:'继续编辑'}).click();
      check(await visualSheet.isVisible()&&await visualSheet.getByLabel('本次进展',{exact:true}).inputValue()==='未保存的跟进草稿','unsaved note is retained when cancelling close');
      await visualSheet.getByRole('button',{name:'关闭物料跟进'}).click();
      await discard.getByRole('button',{name:'放弃未保存内容'}).click();
      await visualSheet.waitFor({state:'detached'});
      check(await page.evaluate(()=>new URL(location.href).searchParams.get('taskId'))===f.visual.warehouseTaskId,'discarding an unsaved note retains the warehouse work order');
      await page.setViewportSize({width:1920,height:1080});
      await shot('warehouse-glass-1920x1080');
      await page.setViewportSize({width:1366,height:1024});
      await login('operator','/workspace/procurement?taskId='+encodeURIComponent(f.visual.followUpId));
      await page.getByRole('heading',{name:f.visual.materialModel,exact:true}).waitFor();
      await page.locator('.mf-order').nth(8).waitFor();
      await shot('followup-glass-1366x1024');
      check(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2),'follow-up fits tablet viewport');
      const compose=page.getByLabel('本次进展',{exact:true});
      const composeBox=await compose.boundingBox();
      check(composeBox&&composeBox.y+composeBox.height<=1024,'progress input is visible without document scrolling');
      check(errors.length===0,'no uncaught browser errors: '+errors.join('; '));
      return {passed:true,warehouseTaskId:f.warehouseTaskId,followUpId:followId,checks};
    } catch(error) {await shot('failure-1366x1024');throw error;}
  }`;
  // Parse the generated browser program before invoking the CLI.
  new Function(`return (${code})`);
  if(process.argv.includes('--parse-only')) { console.log('Generated browser program parses'); process.exit(0); }
  writeFileSync(codeFile, code);
  cli(['open', origin + '/login']);
  const result = cli(['run-code', '--filename', codeFile]);
  writeFileSync(join(dir, 'browser-runtime.txt'), result);
  if (!/"passed":\s*true/.test(result)) throw Error(result);
  console.log(result);
} catch (error) {
  writeFileSync(join(dir, 'browser-failure.txt'), String(error).replaceAll(fixture.password, '[disposable-password]'));
  throw error;
} finally {
  rmSync(codeFile, { force: true });
  try { cli(['close']); } catch (error) { console.warn(String(error).replaceAll(fixture.password, '[disposable-password]')); }
}
