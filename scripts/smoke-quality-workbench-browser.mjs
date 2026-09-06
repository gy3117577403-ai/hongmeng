import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const origin = process.env.QUALITY_WORKBENCH_QA_BASE || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Disposable runtime required');
const fixture = JSON.parse(readFileSync(process.env.QUALITY_WORKBENCH_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
const dir = process.env.QUALITY_WORKBENCH_QA_BROWSER_OUTPUT || 'artifacts/quality-workbench'; mkdirSync(dir, { recursive: true });
const codeFile = dir + '/browser-code.generated.cjs';
const uploadFile = dir + '/upload-fixture.png';
writeFileSync(uploadFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=quality-workbench-release', ...args], { encoding: 'utf8', timeout: 180000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (args[0] === 'run-code') writeFileSync(dir + '/browser-runtime.txt', output);
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}
try {
  cli(['open', origin + '/login']);
  const code = `async page => {
    const origin=${JSON.stringify(origin)}, f=${JSON.stringify(fixture)}, checks=[], errors=[];
    page.on('pageerror', error=>errors.push(String(error)));
    const check=(value,label)=>{if(!value)throw Error(label);checks.push(label)};
    let apiCookie='';
    const login=async kind=>{const r=await page.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:f.users[kind].username,password:f.password}});check(r.status()===200,'login '+kind);apiCookie=(r.headers()['set-cookie']||'').match(/hm_session=[^;]+/)?.[0]||'';check(Boolean(apiCookie),'session issued '+kind)};
    // The production cookie stays Secure. Explicitly carry the disposable session
    // for APIRequestContext probes over loopback HTTP; browser UI uses its cookie jar.
    const get=async path=>{const r=await page.request.get(origin+path,{headers:{Cookie:apiCookie}});if(r.status()!==200)throw Error('GET '+path+' returned '+r.status()+': '+await r.text());return r.json()};
    const post=async(path,data)=>{const r=await page.request.post(origin+path,{headers:{Origin:origin,Cookie:apiCookie},data});if(r.status()>=300)throw Error('POST '+path+' returned '+r.status()+': '+await r.text());return r.json()};
    const snap=async name=>page.screenshot({path:'${dir}/'+name+'.png'});
    try {
    await login('admin'); await page.setViewportSize({width:1366,height:1024});
    await page.goto(origin+'/workspace/quality/internal-risks');
    await page.getByRole('button',{name:'建立异常工单',exact:true}).click();
    const form=page.locator('.qv4-intake'); await form.waitFor();
    await form.getByLabel('异常标题',{exact:false}).fill('浏览器验收：压接首件参数核对');
    await form.getByRole('textbox',{name:/^实际问题/}).fill('首件记录与参考参数不一致，核对实测与指导书。');
    await form.locator('.qv4-intake-products .quality-product-choices label').filter({hasText:f.product.specification}).locator('input').check();
    for(const kind of ['lead','worker']){await form.getByLabel('搜索责任人',{exact:true}).fill(f.users[kind].username);await form.locator('.qv3-people-list label').filter({hasText:f.users[kind].name}).locator('input').check();}
    await form.getByLabel('搜索责任人',{exact:true}).fill('');
    await form.getByRole('button',{name:'品质确认人（独立审核）',exact:true}).click();
    await form.locator('.quality-assignee-options button').filter({hasText:f.users.reviewer.username}).click();
    await form.getByRole('button',{name:'关闭发起窗口'}).click();
    await form.getByRole('button',{name:'保留草稿并关闭'}).click();
    await page.getByRole('button',{name:'建立异常工单',exact:true}).click();
    await form.locator('.qv4-intake-fields:not(:disabled)').waitFor();
    check(await form.getByLabel('异常标题',{exact:false}).inputValue()==='浏览器验收：压接首件参数核对','closed text draft restores');
    await snap('tablet-intake');
    await page.setViewportSize({width:390,height:844}); await snap('phone-intake');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'phone intake no horizontal overflow');
    await page.setViewportSize({width:1366,height:1024});
    let failUpload=true;
    await page.route('**/api/quality/internal-risks/*/attachments', async route=>{if(failUpload&&route.request().method()==='POST'){failUpload=false;return route.fulfill({status:503,json:{ok:false,error:'隔离验收：模拟上传失败'}})}return route.continue()});
    await form.locator('.quality-initiate-upload input').setInputFiles(${JSON.stringify(uploadFile)});
    await form.getByRole('button',{name:'提交并分派',exact:true}).click();
    await form.getByRole('alert').filter({hasText:'附件上传失败'}).waitFor();check(await form.count()===1,'failed upload retains draft');
    await form.getByRole('button',{name:'提交并分派',exact:true}).click();await form.waitFor({state:'detached'});
    await page.waitForURL(/reportId=/);
    const id=await page.evaluate(()=>new URL(window.location.href).searchParams.get('reportId'));check(Boolean(id),'create keeps report context');
    let r=(await get('/api/quality/internal-risks/'+id)).report;
    check(r.workflow.phase==='SUBMITTED'&&r.tasks.length===2&&r.attachments.length===1,'UI creation creates one event, two tasks, one retried attachment');
    await snap('tablet-workbench');
    const leadId=r.tasks.find(t=>t.ownerUserId===f.users.lead.id).id,workerId=r.tasks.find(t=>t.ownerUserId===f.users.worker.id).id;
    const openTask=async(kind,taskId)=>{await login(kind);await page.goto(origin+'/workspace/quality-tasks?reportId='+id+'&taskId='+taskId);await page.locator('#task-'+taskId).waitFor()};
    const complete=async(taskId,result)=>{const task=page.locator('#task-'+taskId);if(await task.getByRole('button',{name:'接单并开始处理'}).count())await task.getByRole('button',{name:'接单并开始处理'}).click();await task.getByLabel('采取了什么措施',{exact:false}).fill('核对原图并复测首件');await task.getByLabel('处理结果',{exact:false}).fill(result);await task.getByRole('button',{name:'提交处理结果',exact:true}).click();await task.locator('.qv3-readonly').waitFor()};
    await openTask('lead',leadId);
    await page.locator('#task-'+leadId).getByRole('button',{name:'接单并开始处理'}).click();
    const resultInput=page.locator('#task-'+leadId).getByLabel('处理结果',{exact:false});
    await resultInput.fill('断网或并发时需要保留的结果');
    await page.locator('#task-'+leadId).getByLabel('采取了什么措施',{exact:false}).fill('已核对原图');
    await login('worker');r=(await get('/api/quality-tasks?reportId='+id)).reports.find(x=>x.id===id);
    await post('/api/quality/internal-risks/'+id+'/stage',{expectedVersion:r.version,action:'START_TASK',payload:{taskId:workerId}});
    await login('lead');await page.locator('#task-'+leadId).getByRole('button',{name:'保存草稿',exact:true}).click();
    await page.getByRole('button',{name:'读取最新记录（保留草稿）'}).waitFor();
    check(await resultInput.inputValue()==='断网或并发时需要保留的结果','conflict retains typed result');
    const refreshButton=page.getByRole('button',{name:'读取最新记录（保留草稿）'});
    await Promise.all([page.waitForResponse(response=>response.url().includes('/api/quality-tasks?reportId='+id)&&response.status()===200),refreshButton.click()]);
    await page.waitForFunction(()=>!document.querySelector('.qv3-error button')?.disabled);
    await complete(leadId,'首件核对完成');await openTask('worker',workerId);await complete(workerId,'现场复核完成');
    await openTask('lead',leadId);await page.getByText('牵头人汇总原因与方案，提交品质确认',{exact:true}).waitFor();
    const fillAnalysis=async()=>{for(const [key,value] of Object.entries({occurrenceCause:'原图要求抄录不一致',rootCause:'发布前复核不足',finalConclusion:'核对后统一要求',correctiveAction:'修订指导书并核对首件'}))await page.locator('#quality-field-'+key+' textarea').fill(value);await page.getByRole('button',{name:'提交品质确认',exact:true}).click();await page.locator('.qv4-next .phase-verifying').waitFor()};
    await fillAnalysis();
    await login('reviewer');await page.goto(origin+'/workspace/quality-confirmation?reportId='+id);await page.getByRole('button',{name:'退回指定责任人补充'}).click();await page.getByLabel('退回原因',{exact:false}).fill('补充一次复测记录');await page.locator('.qv3-return-form input[type=checkbox]').first().check();await page.getByRole('button',{name:'确认定向退回'}).click();await page.locator('.qv4-next .phase-collaborating').waitFor();
    r=(await get('/api/quality/internal-risks/'+id)).report;const returned=r.tasks.find(t=>t.status==='IN_PROGRESS');check(r.tasks.filter(t=>t.status==='COMPLETED').length===1,'targeted return preserves other result');
    const returnedKind=returned.ownerUserId===f.users.lead.id?'lead':'worker';await openTask(returnedKind,returned.id);await complete(returned.id,'第二轮复测完成');await openTask('lead',leadId);await fillAnalysis();
    await login('reviewer');await page.goto(origin+'/workspace/quality-confirmation?reportId='+id);await page.getByLabel('验证结果',{exact:false}).fill('独立复测首件与图纸一致，资料齐全');
    check(await page.evaluate(()=>{const panel=document.querySelector('.qv3-review-layout').getBoundingClientRect();const card=document.querySelector('.qv3-review-layout>.qv3-analysis').getBoundingClientRect();return card.width>=panel.width-2}),'confirmation cards use the available workspace width');
    await snap('tablet-confirmation');await page.locator('#quality-confirmation-form').scrollIntoViewIfNeeded();await snap('tablet-confirmation-form');
    await page.getByRole('button',{name:'验证通过，进入待归档'}).click();await page.getByText('检查归档条件，预览并归档',{exact:true}).waitFor();
    await login('admin');await page.goto(origin+'/workspace/quality/internal-risks?reportId='+id);await page.getByRole('button',{name:'归档发布',exact:true}).click();await page.locator('.risk-archive-modal').waitFor();await snap('archive-impact');await page.getByRole('button',{name:'确认归档并发布警示'}).click();await page.locator('.risk-archive-modal').waitFor({state:'detached'});
    await page.setViewportSize({width:390,height:844});await snap('phone-detail');await page.getByRole('button',{name:'返回列表',exact:true}).click();await snap('phone-queue');check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'phone list no horizontal overflow');
    await page.setViewportSize({width:1366,height:1024});await page.goto(origin+'/workspace/quality/internal-risks/'+id+'/print-preview');await page.getByRole('button',{name:'适合窗口',exact:true}).click();await snap('print-preview');
    const printData=(await get('/api/quality/internal-risks/'+id+'/print-preview')).preview;
    await page.goto(origin+printData.warning.employeePath);await page.setViewportSize({width:390,height:844});await snap('phone-published-warning');
    check(!errors.length,'no uncaught browser errors: '+errors.join(';'));return {passed:true,reportId:id,checks};
    } catch(error) { await snap('failure'); throw error; }
  }`;
  writeFileSync(codeFile, code);
  const result = cli(['run-code', '--filename', codeFile]); writeFileSync(dir + '/browser-runtime.txt', result);
  if (!/"passed":\s*true/.test(result)) throw Error(result);
  console.log(result);
} finally { rmSync(codeFile, { force: true }); rmSync(uploadFile, { force: true }); cli(['close']); }
