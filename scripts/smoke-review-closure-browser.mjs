import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
const origin = process.env.REVIEW_QA_BASE || 'http://127.0.0.1:3000';
if (process.env.REVIEW_QA_ALLOW !== 'disposable-review-runtime' || !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('Disposable runtime required');
const fixture = JSON.parse(readFileSync(process.env.REVIEW_QA_FIXTURE, 'utf8'));
const dir = process.env.REVIEW_QA_OUTPUT || 'output/playwright/review-closure'; mkdirSync(dir, { recursive: true });
function cli(args) {
  const cmd = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const r = spawnSync(cmd, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=review-closure', ...args], { encoding: 'utf8', timeout: 240000 });
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (args[0] === 'run-code') writeFileSync(dir + '/browser-runtime.txt', out);
  if (r.error || r.status || /### Error/.test(out)) throw Error(r.error?.message || out);
  return out;
}
try {
  writeFileSync(dir + '/initial-snapshot.txt', cli(['open', origin + '/login']));
  const code = `async page => {
    const f=${JSON.stringify(fixture)}, origin=${JSON.stringify(origin)}, dir=${JSON.stringify(dir)}, checks=[], errors=[];
    const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
    const route=origin+'/workspace/quality-fixtures?product='+f.product.id+'&q='+f.marker+'&week=2026-09-28';
    page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));
    const api=async()=>{const r=await page.request.get(origin+'/api/quality-fixtures?product='+f.product.id);check(r.ok(),'current review HTTP');return (await r.json()).data;};
    const login=async role=>{await page.context().clearCookies();const r=await page.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:f.users[role].username,password:f.password}});check(r.status()===200,role+' login');await page.goto(route);await page.locator('.qf-reading-identity h2').waitFor();};
    const mutate=async data=>page.request.post(origin+'/api/quality-fixtures',{headers:{Origin:origin,'Idempotency-Key':crypto.randomUUID()},data});
    const sign=async role=>{await login(role==='SUPERVISOR'?'supervisor':'quality');const name=role==='SUPERVISOR'?'主管':'品质';await page.getByRole('button',{name:name+'审核',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('已核对审核资料').check();await dialog.getByRole('button',{name:'确认'+name+'通过',exact:true}).click();await dialog.waitFor({state:'hidden'});};
    try {
      await page.setViewportSize({width:1366,height:1024});await login('tech');
      const entry=page.getByRole('button',{name:'重新提交审核',exact:true});await entry.waitFor();
      check(await entry.isEnabled(),'legacy stranded return has an enabled resubmit entry');
      const recovered=await api();check(recovered.chosen.id===f.draftId && recovered.reviewDecision.state==='RETURN_READY','opening the page reconciles the stranded review automatically');
      check(await page.locator('.qf-audit-footer').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'tablet primary controls stay visible');
      await page.screenshot({path:dir+'/01-recovered-current-review.png'});
      await entry.click();let drawer=page.getByRole('dialog',{name:'退回处理与复核'});await drawer.waitFor();
      await drawer.getByRole('button',{name:'保存并重新提交审核',exact:true}).click();
      const current=drawer.getByRole('button',{name:'进入当前审核',exact:true});await current.waitFor();
      await page.screenshot({path:dir+'/02-resubmitted-return.png'});await current.click();await drawer.waitFor({state:'hidden'});
      check(new URL(page.url()).searchParams.get('q')===f.marker && new URL(page.url()).searchParams.get('week')==='2026-09-28','closing review drawer preserves origin filters');
      const submitted=await api();check(submitted.chosen.status==='REVIEWING' && submitted.chosen.id===f.draftId,'resubmission uses current draft once');
      await sign('SUPERVISOR');
      await login('tech');const replacement=await page.request.post(origin+'/api/drawing-library/'+f.product.id+'/files/upload',{headers:{Origin:origin},multipart:{categoryId:f.files.sop.categoryId,replaceFileId:f.files.sop.id,discardPrevious:'true',file:{name:'SOP-V2.pdf',mimeType:'application/pdf',buffer:Buffer.from(f.pdfBase64,'base64')}}});
      check(replacement.ok(),'pending-review SOP replacement uploads to real storage');const replacementId=(await replacement.json()).file.id;
      await page.reload();await page.getByRole('button',{name:'处理退回',exact:true}).waitFor();const replaced=await api();
      const stopped=replaced.product.fixturePackages.find(p=>p.id===submitted.chosen.id);check(stopped.status==='STALE' && stopped.supervisorId===f.users.supervisor.id,'old round stops while preserving supervisor signature');
      await login('quality');const stale=await mutate({action:'APPROVE',id:stopped.id,version:stopped.version,reviewRole:'QUALITY',confirmed:true});check(stale.status()===409,'stopped round cannot approve with a valid reviewer');await login('tech');
      await page.getByRole('button',{name:'处理退回',exact:true}).click();drawer=page.getByRole('dialog',{name:'退回处理与复核'});await drawer.getByRole('button',{name:'更换文件',exact:true}).click();
      await drawer.getByLabel('更换后的版本',{exact:true}).selectOption(replacementId);
      await drawer.getByLabel('修改说明',{exact:true}).fill('已修订 SOP 并逐项核对退回意见');
      const reloaded=page.waitForResponse(r=>r.url().includes('/api/quality-fixtures?returns=') && r.ok());await drawer.getByLabel('上传替换文件').setInputFiles({name:'SOP-V3.pdf',mimeType:'application/pdf',buffer:Buffer.from(f.pdfBase64,'base64')});
      await reloaded;
      check(await drawer.getByLabel('修改说明',{exact:true}).inputValue()==='已修订 SOP 并逐项核对退回意见','upload preserves unsaved response');
      await drawer.getByRole('button',{name:'保存并重新提交审核',exact:true}).click();await drawer.getByRole('button',{name:'进入当前审核',exact:true}).waitFor();await drawer.getByRole('button',{name:'进入当前审核',exact:true}).click();
      await sign('QUALITY');let pending=await api();check(pending.chosen.status==='SUPERVISOR' && pending.reviewDecision.label==='待主管审核','quality first waits for the other independent signer');
      await sign('SUPERVISOR');const approved=await api();check(approved.chosen.status==='APPROVED' && approved.reviewDecision.label==='资料已审核','both reviewers finish current round');
      const returns=await (await page.request.get(origin+'/api/quality-fixtures?returns='+f.product.id)).json();check(returns.data.issues.every(i=>i.status==='RESOLVED'),'returned issues close only after both approvals');
      const badges=await (await page.request.get(origin+'/api/quality-fixtures?badges='+f.orderId+'&kind=orders')).json();check(badges.data[0].reviewLabel==='资料已审核' && badges.data[0].printAllowed,'plan badge and print readiness match completed review');
      await page.screenshot({path:dir+'/03-dual-review-complete.png'});
      await login('reader');check(await page.getByRole('button',{name:'编辑资料',exact:true}).isDisabled(),'readonly account cannot edit documents');check(!(await page.locator('body').innerText()).includes('资料同步失败'),'readonly browsing does not send forbidden synchronization writes');
      const denied=await mutate({action:'RECONCILE_REVIEW',libraryItemId:f.product.id});check(denied.status()===403,'readonly cannot invoke repair API');
      await login('tech');await page.getByRole('button',{name:'编辑资料',exact:true}).click();const edit=page.getByRole('dialog',{name:'生产资料准备'});const uploaded=page.waitForResponse(r=>r.url().includes('/api/quality-fixtures?view=') && r.ok());await edit.getByLabel('上传 SOP',{exact:true}).setInputFiles({name:'additional-SOP.pdf',mimeType:'application/pdf',buffer:Buffer.from(f.pdfBase64,'base64')});
      await uploaded;await edit.getByRole('button',{name:'保存并提交审核',exact:true}).click();await edit.waitFor({state:'hidden'});
      check((await api()).chosen.status==='REVIEWING','upload followed by save uses synchronized package version');
      check(errors.length===0,'no uncaught browser errors');return {passed:true,checks,errors};
    }catch(error){await page.screenshot({path:dir+'/failure.png'});throw error;}
  }`;
  const file = dir + '/browser.generated.cjs'; writeFileSync(file, code);
  const output = cli(['run-code', '--filename', file]);
  if (!/"passed":\s*true/.test(output)) throw Error('Browser acceptance did not pass');
  console.log('Review closure browser acceptance passed');
} finally { try { cli(['close']); } catch {} }
