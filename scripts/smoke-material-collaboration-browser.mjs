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
  cli(['open', origin + '/login']);
  const code = `async page => {
    const origin=${JSON.stringify(origin)}, f=${JSON.stringify(fixture)}, dir=${JSON.stringify(dir)};
    const checks=[], errors=[];
    page.on('pageerror', error => errors.push(String(error)));
    const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label)};
    const api=async(path,method='GET',data)=>page.evaluate(async input=>{
      const response=await fetch(input.path,{method:input.method,headers:{'content-type':'application/json'},body:input.data?JSON.stringify(input.data):undefined});
      return {status:response.status,body:await response.json().catch(()=>({}))};
    },{path,method,data});
    const shot=async name=>page.screenshot({path:dir+'/'+name+'.png',fullPage:false});
    const login=async kind=>{
      await page.context().clearCookies(); await page.goto(origin+'/login');
      await page.getByLabel('员工编号 / 管理账号').fill(f.users[kind].username);
      await page.getByLabel('密码',{exact:true}).fill(f.password);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.waitForURL(url=>url.pathname!=='/login',{timeout:30000});
      const signedIn=await api('/api/material-follow-ups?status=ACTIVE&pageSize=1');
      check(signedIn.status===200,'signed-in material access '+kind);
      check(true,'browser login '+kind);
    };
    try {
      await page.setViewportSize({width:1366,height:1024});
      await login('warehouse');
      const initial='/workspace/warehouse?taskId='+encodeURIComponent(f.warehouseTaskId)+'&status=pending';
      await page.goto(origin+initial);
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
      await page.waitForFunction(id=>new URL(location.href).searchParams.get('taskId')===id&&new URL(location.href).searchParams.get('status')==='exception',f.warehouseTaskId);
      await page.locator('.mw-ui-order.active.mw-ui-order-exception').waitFor();
      check(await page.evaluate(()=>location.pathname)==='/workspace/warehouse','register stays in warehouse page');
      check(await page.locator('.mw-ui-order.active').count()===1,'same warehouse order remains selected');
      const warehouse=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId);
      check(warehouse.status===200&&warehouse.body.task.status==='exception','registered exception persists on same task');
      const event=warehouse.body.task.activeExceptions?.find(item=>item.materialModel===material);
      check(Boolean(event?.followUpId&&event.supplySource==='PURCHASED'&&event.shortageQuantity===5),'one purchased shortage creates linked follow-up');
      const followId=event.followUpId;
      await shot('warehouse-registered-1366x1024');
      await page.locator('.mw-ui-event').filter({hasText:material}).getByRole('link',{name:/查看跟进/}).click();
      await page.waitForURL(url=>url.pathname==='/workspace/procurement'&&url.searchParams.get('taskId')===followId);
      const returnTo=await page.evaluate(()=>new URL(location.href).searchParams.get('returnTo')||'');
      check(returnTo.includes('taskId='+encodeURIComponent(f.warehouseTaskId))&&returnTo.includes('status=exception'),'follow-up preserves exact warehouse context');
      await page.getByRole('heading',{name:f.workOrder.specification}).waitFor({timeout:30000});
      check(await page.getByRole('heading',{name:f.workOrder.specification}).count()===1,'linked issue opens in follow-up detail');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'follow-up fits 1366 tablet width');
      await shot('follow-up-linked-1366x1024');

      await login('ordinary');
      await page.goto(origin+'/workspace/procurement?taskId='+encodeURIComponent(followId)+'&returnTo='+encodeURIComponent(returnTo));
      await page.getByLabel('本次进展',{exact:true}).fill('隔离验收：已确认供方今晚发出五个端子');
      const noteResponse=page.waitForResponse(response=>response.url().includes('/api/material-follow-ups/'+followId)&&response.request().method()==='PATCH');
      await page.getByRole('button',{name:'保存进展',exact:true}).click();
      check((await noteResponse).status()===200,'ordinary logged-in user may save textual progress');
      const followed=await api('/api/material-follow-ups/'+followId);
      check(followed.body.task.latestProgress.includes('今晚发出'),'ordinary progress persists');
      check(followed.body.task.activities.some(activity=>activity.actor?.id===f.users.ordinary.id&&activity.createdAt),'progress keeps author and timestamp');
      check(await page.getByRole('button',{name:/调整处理字段/}).count()===0,'ordinary user cannot edit controlled fields');
      const forged=await api('/api/material-follow-ups/'+followId,'PATCH',{action:'note',version:followed.body.task.version,note:'夹带字段',receivedQuantity:5});
      check(forged.status===400,'ordinary note rejects controlled-field smuggling');
      await page.locator('.mf-latest p').filter({hasText:'今晚发出'}).waitFor();
      await shot('follow-up-progress-1366x1024');

      await login('warehouse');
      const warehouseAfterNote=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId);
      check(warehouseAfterNote.status===200,'warehouse user can read its material task');
      check(warehouseAfterNote.body.task.activities.some(activity=>activity.content?.includes('今晚发出')&&activity.actor?.id===f.users.ordinary.id),'warehouse reads the same authored progress');
      await page.goto(origin+returnTo);
      await page.getByRole('button',{name:'处理记录'}).click();
      const warehouseProgress=page.locator('.ms-timeline article').filter({hasText:'今晚发出'});
      await warehouseProgress.waitFor();
      check((await warehouseProgress.textContent()).includes(f.users.ordinary.displayName),'warehouse timeline shows ordinary author');
      await shot('warehouse-progress-1366x1024');

      await login('operator');
      await page.goto(origin+'/workspace/procurement?taskId='+encodeURIComponent(followId)+'&returnTo='+encodeURIComponent(returnTo));
      await page.getByRole('button',{name:/调整处理字段/}).click();
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

      await login('warehouse');
      const warehousePartial=(await api('/api/warehouse/material-tasks/'+f.warehouseTaskId)).body.task;
      const prematureClose=await api('/api/warehouse/material-tasks/'+f.warehouseTaskId,'PATCH',{action:'resolve',version:warehousePartial.version,exceptionId:event.id,note:'未到齐不能关闭',resolution:'pending'});
      check(prematureClose.status===409,'warehouse cannot close shortage before full arrival');

      await login('operator');
      await page.goto(origin+'/workspace/procurement?taskId='+encodeURIComponent(followId)+'&returnTo='+encodeURIComponent(returnTo));
      const full=await api('/api/material-follow-ups/'+followId,'PATCH',{action:'update',version:partial.version,ownerId:f.users.operator.id,status:'WAITING_WAREHOUSE',receivedQuantity:5,expectedAt:eta,note:'五件端子全部到齐，交仓库核验'});
      check(full.status===200&&full.body.task.status==='WAITING_WAREHOUSE','full arrival enters warehouse confirmation');
      await page.reload();
      const back=page.getByRole('link',{name:/返回对应仓库工单/});
      await back.waitFor();
      check((await back.getAttribute('href')).includes('taskId='+encodeURIComponent(f.warehouseTaskId)),'return action targets original warehouse work order');
      await back.click();
      await page.waitForURL(url=>url.pathname==='/workspace/warehouse'&&url.searchParams.get('taskId')===f.warehouseTaskId);
      await page.getByRole('heading',{name:f.workOrder.specification}).waitFor({timeout:30000});
      check(await page.getByRole('heading',{name:f.workOrder.specification}).count()===1,'return opens the same warehouse work order');

      await login('warehouse');
      await page.goto(origin+returnTo);
      await page.locator('.mw-ui-event').filter({hasText:material}).getByRole('button',{name:'核对到料'}).click();
      const verify=page.getByRole('dialog',{name:'确认本项异常解决'});
      await verify.locator('textarea').fill('现场已清点五件端子，实物与型号一致');
      await verify.getByRole('button',{name:'核对完成，确认解决'}).click();
      await verify.waitFor({state:'detached'});
      const resolved=(await api('/api/material-follow-ups/'+followId)).body.task;
      check(resolved.status==='RESOLVED'&&resolved.exceptionCase.status==='RESOLVED','warehouse physical verification closes same issue');
      await page.getByRole('button',{name:'完成配料'}).click();
      await page.waitForFunction(id=>new URL(location.href).searchParams.get('taskId')===id&&new URL(location.href).searchParams.get('status')==='completed',f.warehouseTaskId);
      check((await api('/api/warehouse/material-tasks/'+f.warehouseTaskId)).body.task.status==='completed','warehouse task is completed');
      await shot('warehouse-closed-1366x1024');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'1366 tablet has no page-level horizontal overflow');
      check(errors.length===0,'no uncaught browser errors: '+errors.join('; '));
      return {passed:true,warehouseTaskId:f.warehouseTaskId,followUpId:followId,checks};
    } catch(error) {await shot('failure-1366x1024');throw error;}
  }`;
  // Parse the generated browser program before invoking the CLI.
  new Function(`return (${code})`);
  writeFileSync(codeFile, code);
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
