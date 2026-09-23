import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
if (process.env.ACCOUNT_ACCESS_QA_ALLOW !== 'disposable-account-access') throw Error('Disposable account runtime required');
const origin = process.env.ACCOUNT_ACCESS_QA_BASE || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('Loopback only');
const fixture = JSON.parse(readFileSync(process.env.ACCOUNT_ACCESS_FIXTURE || '/tmp/account-access-fixture.json', 'utf8'));
if (!fixture.marker?.startsWith('ACL-')) throw Error('Unexpected fixture');
const dir = process.env.ACCOUNT_ACCESS_BROWSER_OUTPUT || 'output/playwright/account-access'; mkdirSync(dir, { recursive: true });
const file = join(dir, 'browser.generated.cjs');
function cli(args) {
  const result = spawnSync('npx', ['--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=account-access', ...args], { encoding: 'utf8', timeout: 240000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]').replaceAll(fixture.reader.password, '[disposable-password]');
  if (result.status || result.error) throw Error(output || result.error.message);
  return output;
}
try {
  cli(['open', origin + '/login']); writeFileSync(join(dir, 'initial-snapshot.txt'), cli(['snapshot']));
  writeFileSync(file, `async page => {
    const f=${JSON.stringify(fixture)}, origin=${JSON.stringify(origin)}, dir=${JSON.stringify(dir)}, checks=[], errors=[];
    const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
    const shot=async name=>page.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});
    page.on('pageerror',e=>errors.push(String(e)));
    const login=async (username,password,next)=>{await page.goto(origin+'/login?next='+encodeURIComponent(next));await page.getByLabel('员工编号 / 管理账号').fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(u=>u.pathname===next.split('?')[0]);};
    try {
      await page.setViewportSize({width:1366,height:1024});
      await login(f.username,f.password,'/workspace/employees?view=directory&employeeId='+f.mixed.employeeId);
      await page.getByLabel('搜索员工',{exact:true}).fill(f.marker);
      await page.getByRole('button',{name:'账号管理',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'账号与访问管理',exact:true});await dialog.waitFor();
      check(new URL(page.url()).pathname==='/workspace/employees','opening account dialog keeps HR background route');
      check(await page.locator('.hr-module-tabs').isVisible(),'HR remains mounted behind modal');
      await dialog.getByLabel('搜索员工账号').fill(f.mixed.name);await dialog.locator('.aa-account').filter({hasText:f.mixed.name}).click();
      check(await dialog.locator('.aa-module').count()===7,'seven actual modules shown together');
      check(await dialog.getByLabel('开通物料与仓储',{exact:true}).isChecked(),'saved materials permission checked');
      check(await dialog.locator('.aa-module').filter({hasText:'技术与资料'}).getByRole('button',{name:'只读',exact:true}).getAttribute('aria-pressed')==='true','mixed read and collaboration levels restored');
      await shot('module-permissions-1366');
      check(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'dialog has no horizontal overflow');
      check(await dialog.locator('.aa-editor-footer').getByRole('button',{name:'保存配置'}).isVisible(),'save footer stays visible on tablet');
      await dialog.getByLabel('开通人事与工时',{exact:true}).check();
      await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('alertdialog',{name:'未保存的账号修改'}).waitFor();
      await page.getByRole('button',{name:'继续编辑',exact:true}).click();
      check(await dialog.getByLabel('开通人事与工时',{exact:true}).isChecked(),'cancel confirmation retains unsaved selections');
      const saved=page.waitForResponse(r=>r.url().endsWith('/api/users/module-access')&&r.request().method()==='POST');
      await dialog.getByRole('button',{name:'保存配置',exact:true}).click(); const response=await saved;check(response.status()===200,'UI saves module configuration through backend');
      await dialog.getByRole('status').waitFor();
      const data=await response.json();check(data.user.moduleAccess.permissions.people==='READ','new module defaults to read-only');
      check(data.user.moduleAccess.permissions.materials==='COLLABORATE','changing one module preserves other selected modes');
      await page.setViewportSize({width:2048,height:1100});await shot('module-permissions-2048');
      await dialog.getByRole('button',{name:'关闭账号管理',exact:true}).click();await dialog.waitFor({state:'detached'});
      check(new URL(page.url()).pathname==='/workspace/employees','closing outer dialog returns to HR');
      check(await page.getByLabel('搜索员工',{exact:true}).inputValue()===f.marker,'HR search is retained');
      await page.getByRole('button',{name:'账号管理',exact:true}).click();await dialog.waitFor();await dialog.getByLabel('搜索员工账号').fill(f.reader.name);await dialog.locator('.aa-account').filter({hasText:f.reader.name}).click();
      await page.goBack();await dialog.waitFor();check(await dialog.locator('.aa-welcome').isVisible(),'browser back closes inner editor first');
      await page.goBack();await dialog.waitFor({state:'detached'});check(new URL(page.url()).pathname==='/workspace/employees','second back closes account layer without switching workbench');
      await page.goto(origin+'/workspace/employees/accounts?employeeId='+f.mixed.employeeId);await dialog.waitFor();check(new URL(page.url()).pathname==='/workspace/employees','old account link redirects to HR modal');
      await dialog.getByRole('button',{name:'关闭账号管理',exact:true}).click();await dialog.waitFor({state:'detached'});
      await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));
      await login(f.reader.username,f.reader.password,'/workspace/employees?view=directory');
      await page.locator('.aa-readonly-banner').waitFor();check(await page.getByRole('button',{name:'账号管理',exact:true}).count()===0,'read-only HR cannot open account administration');
      await page.goto(origin+'/workspace/knowledge');await page.getByRole('button',{name:'新增知识',exact:true}).waitFor();check(await page.getByRole('button',{name:'新增知识',exact:true}).isDisabled(),'read-only technology disables new knowledge action');await shot('readonly-knowledge-2048');
      for(const route of ['/weekly-plan-center','/workspace/quality/data','/workspace/procurement','/drawing-library','/workspace/workflows','/workspace/reports']) {
        await page.goto(origin+route);await page.waitForLoadState('domcontentloaded');check(new URL(page.url()).pathname===route,'read-only can open '+route);
      }
      check(errors.length===0,'no uncaught browser errors');return {ok:true,checks};
    } catch(e) {await shot('failure').catch(()=>{});throw e;}
  }`);
  const result = cli(['run-code', '--filename', file]); writeFileSync(join(dir, 'browser-result.txt'), result);
  const section = result.match(/### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/); const accepted = section ? JSON.parse(section[1].trim()) : null;
  if (accepted?.ok !== true || accepted.checks?.length < 18) throw Error(result); console.log(result);
} finally { try { cli(['close']); } catch {} rmSync(file, { force: true }); }
