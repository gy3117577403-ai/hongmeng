import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const origin = process.env.PRODUCTION_BOARD_QA_BASE || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Disposable local runtime required');
const fixture = JSON.parse(readFileSync(process.env.PRODUCTION_BOARD_QA_FIXTURE, 'utf8'));
const dir = 'artifacts/production-collaboration'; mkdirSync(dir, { recursive: true });
function cli(args) {
  const result = spawnSync('npx', ['--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=production-release', ...args], { encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}
try {
  cli(['open', `${origin}/login`]);
  writeFileSync(`${dir}/initial-browser-snapshot.txt`, cli(['snapshot']));
  const code = `async (page) => {
    const origin=${JSON.stringify(origin)}, fixture=${JSON.stringify(fixture)};
    const check=(value,message)=>{if(!value)throw Error(message)};
    check((await page.request.post(origin+'/api/auth/login',{data:{username:fixture.username,password:fixture.password}})).status()===200,'disposable login');
    const responses=[], failures=[]; let failNext=true;
    page.on('pageerror',error=>failures.push(String(error)));
    page.on('response',async response=>{
      if(!response.url().includes('/api/work-orders/execution?')||response.status()!==200)return;
      const body=await response.json().catch(()=>null);
      if(body?.data)responses.push({offset:Number(response.url().match(/[?&]offset=(\\d+)/)?.[1]||0),token:body.data.pagination.snapshotToken,count:body.data.items.length});
    });
    await page.route('**/api/work-orders/execution?*',async route=>{
      const offset=Number(route.request().url().match(/[?&]offset=(\\d+)/)?.[1]||0);
      if(offset>0&&failNext){failNext=false;await route.fulfill({status:500,json:{ok:false,error:'隔离验收：模拟下一页失败'}});return;}
      await page.waitForTimeout(150);await route.continue();
    });
    await page.setViewportSize({width:1366,height:1024});
    await page.goto(origin+'/production?scope=current&keyword='+encodeURIComponent(fixture.keyword));
    await page.waitForSelector('[data-production-order-id]');
    const rows=()=>page.locator('[data-production-order-id]').count();
    const scroll=()=>page.locator('.production-dispatch-list').evaluate(el=>{el.style.scrollBehavior='auto';el.scrollTop=el.scrollHeight});
    for(let i=0;i<55;i++){await scroll();await page.waitForTimeout(150);if(await page.getByRole('button',{name:'重试加载下一页',exact:true}).count())break;}
    check(await rows()===60,'failed next page must retain 60 rows');
    const failedCount=responses.length;await page.waitForTimeout(400);check(responses.length===failedCount,'failed page must not loop');
    await page.getByRole('button',{name:'重试加载下一页',exact:true}).click();
    for(let i=0;i<55;i++){await scroll();await page.waitForTimeout(150);if(await rows()===76)break;}
    check(await rows()===76,'all 76 database rows load after retry');
    const first=responses.find(item=>item.offset===0),second=responses.find(item=>item.offset===60);
    check(first?.token&&first.token===second?.token,'next page carries the same scope-bound snapshot');
    await page.waitForTimeout(250);
    const before=await page.locator('.production-dispatch-list').evaluate(el=>el.scrollTop);
    const start=responses.length;
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hongmeng:production-data-invalidated',{detail:{kind:'plan-batch-updated',entityId:'browser-qa',occurredAt:Date.now(),nonce:'qa-'+Date.now()}})));
    const frames=[];
    for(let i=0;i<100;i++){await page.waitForTimeout(100);frames.push(await rows());if(responses.slice(start).some(item=>item.offset===60)&&i>12)break;}
    check(frames.every(count=>count===76),'refresh must never truncate rendered rows');
    const refreshed=responses.slice(start);check(refreshed.some(item=>item.offset===0)&&refreshed.some(item=>item.offset===60),'refresh replaces the entire loaded range');
    const after=await page.locator('.production-dispatch-list').evaluate(el=>el.scrollTop);
    check(Math.abs(after-before)<=2,'refresh preserves scroll position');
    check(!failures.length,'no uncaught browser errors: '+failures.join(';'));
    await page.screenshot({path:'${dir}/production-76-rows.png'});
    return {passed:true,rows:76,frames,scroll:{before,after},responses,checks:['database pages 60+16','manual retry retains rows','scope-bound stable snapshot','refresh retains 76 rows','scroll retained','no uncaught errors']};
  }`;
  const output = cli(['run-code', code]);
  writeFileSync(`${dir}/browser-runtime.txt`, output);
  if (!/"passed":\s*true/.test(output)) throw new Error(`Browser acceptance did not pass: ${output}`);
  console.log(output);
} finally { cli(['close']); }
