import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const origin=process.env.PROCESS_QUALITY_QA_BASE||'http://127.0.0.1:3000';
if (!['127.0.0.1','localhost'].includes(new URL(origin).hostname)) throw Error('Disposable runtime required');
const f=JSON.parse(readFileSync(process.env.PROCESS_QUALITY_QA_FIXTURE,'utf8').replace(/^\uFEFF/,''));
const dir=process.env.PROCESS_QUALITY_QA_BROWSER_OUTPUT||'artifacts/process-quality';mkdirSync(dir,{recursive:true});
const codeFile=dir+'/browser.generated.cjs';
function cli(args) {
  const command=process.platform==='win32'?process.execPath:'npx', prefix=process.platform==='win32'?[join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js')]:[];
  const r=spawnSync(command,[...prefix,'--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=process-quality-release',...args],{encoding:'utf8',timeout:240000,windowsHide:true});
  const output=((r.stdout||'')+(r.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(f.password,'[disposable-password]');
  if(args[0]==='run-code')writeFileSync(dir+'/browser-runtime.txt',output);
  if(r.error||r.status||/### Error/.test(output))throw Error(r.error?.message||output);return output;
}
try {
  cli(['open',origin+'/login']);
  writeFileSync(codeFile,`async page => {
    const base=${JSON.stringify(origin)}, f=${JSON.stringify(f)}, dir=${JSON.stringify(dir)}, checks=[], errors=[];
    page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
    const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)}, snap=async name=>page.screenshot({path:dir+'/'+name+'.png'});
    const login=async actor=>{const r=await page.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{username:f.users[actor].username,password:f.password}});check(r.status()===200,'login '+actor)};
    const order=f.orders[1]||f.orders[0];
    try {
    await login('operator');await page.setViewportSize({width:390,height:844});await page.goto(base+'/field-report/'+order.publicCode);
    await page.locator('.process-current-card').waitFor();check(await page.locator('.field-report-step-list').count()===0,'60 processes do not occupy a long page');await snap('phone-current');
    await page.locator('.process-current-card>button').click();const picker=page.locator('.process-picker.mobile');await picker.waitFor();
    check(await picker.locator('.process-picker-row').count()===order.count,'all route steps use real data');
    await picker.getByRole('textbox',{name:'搜索工序'}).fill('导通');check(await picker.locator('.process-picker-row').count()===2,'duplicate continuity steps remain independently selectable');await snap('phone-search-continuity');
    await picker.locator('.process-picker-row').filter({hasText:'导通（B端）'}).click();const sheet=page.locator('.field-report-sheet');await sheet.waitFor();
    check(await sheet.locator('.pquality').count()===1,'continuity quality fields only on selected inspection');
    check(await sheet.getByText('不良责任人',{exact:true}).count()===0,'zero defects have no responsibility field');
    const qty=sheet.locator('.field-report-quantity-card input');await qty.nth(0).fill('12');await qty.nth(1).fill('2');
    await sheet.getByRole('button',{name:'选择责任人',exact:true}).click();await sheet.getByRole('textbox',{name:'搜索责任人'}).fill(f.users.other.username);
    await sheet.locator('.pquality-people button').filter({hasText:f.users.other.name}).click();await sheet.getByRole('button',{name:'完成选择',exact:true}).click();
    await sheet.locator('.pquality-more>summary').click();await sheet.getByRole('textbox',{name:'质量问题说明'}).fill('B端导通不良，已定位');await snap('phone-continuity-responsibility');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'phone no horizontal overflow');
    await sheet.getByRole('button',{name:'关闭报工窗口',exact:true}).click();
    await page.locator('.process-current-card>button').click();await picker.getByRole('textbox',{name:'搜索工序'}).fill('裁线');await picker.locator('.process-picker-row').click();await sheet.waitFor();
    check(await sheet.locator('.pquality').count()===0,'ordinary process has no quality panel');await snap('phone-ordinary');
    await sheet.getByRole('button',{name:'关闭报工窗口',exact:true}).click();await page.locator('.process-current-card>button').click();await picker.getByRole('textbox',{name:'搜索工序'}).fill('导通');await picker.locator('.process-picker-row').filter({hasText:'导通（B端）'}).click();
    await sheet.getByRole('button',{name:'恢复并核对'}).click();check(await sheet.locator('.field-report-quantity-card input').first().inputValue()==='12','draft restored by exact step ID');
    check(await sheet.getByRole('textbox',{name:'质量问题说明'}).inputValue()==='B端导通不良，已定位','quality draft retained with route step');
    const submit=sheet.locator('footer button').filter({hasText:'报工'}).last();await submit.click();await page.locator('.field-report-success').waitFor();await snap('phone-report-receipt');
    await page.locator('.field-report-success button').last().click();
    await page.getByRole('button',{name:'批量报工',exact:true}).click();await page.locator('.process-current-card>button').click();await picker.getByRole('textbox',{name:'搜索工序'}).fill('压检');await picker.locator('.process-picker-row').first().click();await picker.locator('.process-picker-row').last().click();await snap('phone-batch-selected');await picker.getByRole('button',{name:'完成选择'}).click();await page.getByRole('button',{name:'填写数量与人员'}).click();
    check(await sheet.locator('.field-report-batch-items article').count()===2,'batch shows only selected route steps');check(await sheet.locator('.field-report-batch-items .pquality').count()===2,'batch quality stays with each step ID');await snap('phone-batch-form');
    await login('admin');await page.setViewportSize({width:1366,height:1024});await page.goto(base+'/production?workOrderId='+order.id);
    // Open the selected work order through the actual production card action.
    const candidates=page.locator('[data-production-order-id="'+order.id+'"] .production-dispatch-row-actions>button.primary');
    await candidates.first().click();await page.locator('.process-completion-dialog').waitFor();
    const routePicker=page.locator('.process-completion-route-sidebar');check(await routePicker.count()===1,'desktop long route has independent sidebar');
    await routePicker.getByRole('textbox',{name:'搜索工序'}).fill('检验');await routePicker.locator('.process-picker-row').first().click();await page.locator('.process-completion-dialog .pquality').waitFor();await snap('desktop-final-inspection');
    await page.setViewportSize({width:1024,height:768});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'short desktop has no horizontal page overflow');await snap('desktop-compact');
    await page.goto(base+'/workspace/quality/data');await page.setViewportSize({width:1366,height:1024});await page.getByRole('button',{name:'更多筛选'}).click();await page.getByRole('combobox',{name:'数据来源'}).selectOption('report');await snap('quality-ledger-report-source');
    await page.getByRole('button',{name:'导通检验',exact:true}).click();await page.locator('.qd-record-card').first().click();await page.locator('.qd-report-source').waitFor();await snap('quality-report-detail');
    check(errors.length===0,'no browser runtime errors: '+errors.join(';'));return {passed:true,checks};
    } catch(error) {await snap('failure');throw Error(error.message+'; completed checks: '+checks.join(', '));}
  }`);
  const result=cli(['run-code','--filename',codeFile]);if(!/"passed"\s*:\s*true/.test(result))throw Error(result);console.log('Quality reporting browser acceptance passed');
} finally { try { cli(['close']); } catch {} if (codeFile.startsWith(dir+'/')) rmSync(codeFile,{force:true}); }
