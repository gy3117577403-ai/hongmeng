import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const origin = process.env.REPORT_RECOVERY_QA_BASE || 'http://127.0.0.1:33133';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname) || process.env.REPORT_RECOVERY_QA_ALLOW !== 'disposable-reporting-runtime') throw Error('Disposable reporting runtime required');
const fixture = JSON.parse(readFileSync(process.env.REPORT_RECOVERY_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
const dir = process.env.REPORT_RECOVERY_QA_BROWSER_OUTPUT || 'output/playwright/reporting-recovery'; mkdirSync(dir, { recursive: true });
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=report-recovery-release', ...args], { encoding: 'utf8', timeout: 180_000, windowsHide: true });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (args[0] === 'run-code') writeFileSync(dir + '/recovery-browser-runtime.txt', output);
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}
try {
  cli(['open', origin + '/login']);
  writeFileSync(dir + '/recovery-initial-snapshot.txt', cli(['snapshot']));
  const code = `async page => {
    const base=${JSON.stringify(origin)}, f=${JSON.stringify(fixture)}, out=${JSON.stringify(dir)}, checks=[], errors=[];
    const check=(value,message)=>{if(!value)throw Error(message);checks.push(message)};
    page.on('pageerror',error=>errors.push(String(error)));
    let apiCookie='';
    const login=async kind=>{const r=await page.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{username:f.users[kind].username,password:f.password}});check(r.status()===200,'login '+kind);apiCookie=(r.headers()['set-cookie']||'').match(/hm_session=[^;]+/)?.[0]||''};
    // Carry the disposable Secure session explicitly for API probes over loopback HTTP.
    await login('operator');
    const order=f.orders.browser;
    const response=await page.request.post(base+'/api/field-report/tickets/'+order.publicCode+'/completions',{headers:{Origin:base,Cookie:apiCookie},data:{stepId:order.stepId,expectedRouteVersion:0,processedQty:0,defectQty:0,reportedUnitQty:40,reportedDefectUnitQty:0,workDate:f.workDate,employeeIds:[f.users.operator.employeeId],expectedUserId:f.users.operator.id,idempotencyKey:f.marker+'-browser',allowPending:true,source:{kind:'NATIVE'}}});
    const body=await response.json();if(response.status()!==202)throw Error('mismatched report response '+response.status()+' '+JSON.stringify(body));check(true,'mismatched report accepted pending');
    const id=body.submission.id;
    await login('handler');
    await page.setViewportSize({width:1366,height:1024});
    await page.goto(base+'/workspace/reporting-recovery?id='+id);
    const recovery=()=>page.locator('.reporting-recovery-root');
    await page.getByRole('dialog',{name:'报工资料核对',exact:true}).waitFor();
    check(page.url()===base+'/production'||page.url().startsWith(base+'/production?'),'legacy handler link opens original production page');
    await recovery().getByRole('heading',{name:'核对实际完成的整套数量'}).waitFor();
    // The production board normalizes its URL after reading the entry context.
    // Verify the loaded record itself instead of a consumed query parameter.
    check((await recovery().locator('.rr-detail-header small').innerText()).includes(id),'legacy link loads the original submission');
    check(await recovery().locator('textarea[required],input[type=text][required]').count()===0,'no mandatory free text');
    const submit=recovery().getByRole('button',{name:'确认并完成原报工',exact:true});
    check(await submit.isDisabled(),'ambiguous action mapping requires explicit selection');
    await recovery().getByLabel('形成完整产品（套）',{exact:true}).fill('40');
    await recovery().getByLabel('已核对动作数量与实际整套数量',{exact:true}).check();
    check(await submit.isEnabled(),'structured confirmation is sufficient');
    await page.screenshot({path:out+'/recovery-desktop-before.png',fullPage:true});
    await submit.click();
    await recovery().getByRole('heading',{name:'原报工已完成',exact:true}).waitFor({timeout:90000});
    const receipt=await (await page.request.get(base+'/api/process-report-submissions/'+id+'/preview',{headers:{Cookie:apiCookie}})).json();
    check(receipt.data.submission.status==='COMPLETED','confirmation actually settles original report');
    check(receipt.data.submission.result.autoAssignedLaborMilliseconds===600000,'original 40 sets credited exactly 10 minutes');
    await page.screenshot({path:out+'/recovery-desktop-completed.png',fullPage:true});
    await login('operator');
    await page.setViewportSize({width:390,height:844});
    await page.goto(base+'/workspace/reporting-recovery?id='+id);
    await recovery().getByRole('heading',{name:'原报工已完成',exact:true}).waitFor();
    check(page.url().startsWith(base+'/workspace/reporting-recovery?'),'field operator retains authorized historical receipt without production access');
    check(await recovery().getByRole('button',{name:'确认并完成原报工',exact:true}).count()===0,'operator sees own receipt without handler controls');
    const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));check(size.scroll<=size.width,'mobile recovery has no horizontal overflow');
    await page.screenshot({path:out+'/recovery-mobile-receipt.png',fullPage:true});
    check(!errors.length,'no uncaught browser errors: '+errors.join(';'));
    return {passed:true,checks,submissionId:id,completionId:receipt.data.submission.completionId};
  }`;
  const codeFile=dir+'/recovery-browser-code.generated.cjs';writeFileSync(codeFile, code);
  const result=cli(['run-code','--filename',codeFile]);
  if (!/"passed":\s*true/.test(result)) throw Error(result);
  console.log(result);
} finally { cli(['close']); }
