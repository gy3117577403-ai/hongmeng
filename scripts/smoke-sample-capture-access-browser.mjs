import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
if (process.env.SAMPLE_LIBRARY_QA_ALLOW !== 'disposable-sample-library') throw Error('Disposable runtime required');
const origin = process.env.SAMPLE_LIBRARY_QA_BASE || 'http://127.0.0.1:3000';
if (!['localhost','127.0.0.1'].includes(new URL(origin).hostname)) throw Error('Loopback only');
const f = JSON.parse(readFileSync(process.env.SAMPLE_LIBRARY_FIXTURE || '/tmp/sample-library-fixture.json','utf8'));
if (!f.marker?.startsWith('SL-') || !f.captureUsername) throw Error('Unexpected fixture');
const engine = process.env.SAMPLE_LIBRARY_BROWSER || 'chrome';
const dir = join(process.env.SAMPLE_LIBRARY_BROWSER_OUTPUT || 'output/playwright/sample-library','capture-access');
mkdirSync(dir,{recursive:true});
const file = join(dir,'browser.generated.cjs'), config = join(dir,'browser.config.json');
// Failure injection is confined to this isolated loopback test browser.
writeFileSync(config,JSON.stringify({browser:{contextOptions:{ignoreHTTPSErrors:new URL(origin).protocol==='https:',serviceWorkers:'block'}}}));
function cli(args) {
  const r=spawnSync('npx',['--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=sample-capture-access',...args],{encoding:'utf8',timeout:240000});
  const text=((r.stdout||'')+(r.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(f.password,'[disposable-password]');
  if(r.status||r.error)throw Error(text||r.error.message);return text;
}
async function scenario(page,f,origin,dir,engine) {
  const checks=[],errors=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const shot=name=>page.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());page.setDefaultTimeout(20000);
  const next='/sample-capture/'+f.captureTaskCode+'?tab=photos';
  const logout=()=>page.request.post(origin+'/api/auth/logout');
  const fillLogin=async username=>{await page.getByLabel('员工编号 / 管理账号').fill(username);await page.getByLabel('密码',{exact:true}).fill(f.password);await page.getByRole('button',{name:'登录',exact:true}).click();};
  const login=async(username,destination)=>{await page.goto(origin+'/login?next='+encodeURIComponent(destination));await fillLogin(username);await page.waitForURL(u=>u.pathname===destination.split('?')[0]);};
  const queueValue=()=>page.evaluate(async ({id,code})=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hongmeng-sample-capture',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const key='sample-capture:user:'+encodeURIComponent(id)+':task:'+encodeURIComponent(code)+':photo-queue-v2';
    const v=await new Promise(resolve=>{const r=db.transaction('pending-photos','readonly').objectStore('pending-photos').get(key);r.onsuccess=()=>resolve(r.result);});db.close();
    return v?.items?.map(i=>({mutationId:i.mutationId,name:i.originalName,status:i.status,size:i.file.size}))||[];
  },{id:f.captureUserId,code:f.captureTaskCode});
  try {
    await page.setViewportSize({width:390,height:844});
    const library='/sample-library?product='+f.productId;
    await login(f.soloUsername,library);await page.getByRole('heading',{name:'当前账号尚未开通'}).waitFor();
    check(await page.evaluate(()=>location.pathname)==='/sample-library','ungranted QR remains in mobile library instead of desktop fallback');
    check(await page.getByText(f.soloUsername,{exact:false}).isVisible(),'mobile notice identifies signed-in employee');await shot('mobile-missing-access');
    await page.getByRole('button',{name:'切换账号',exact:true}).click();await page.waitForURL(u=>u.pathname==='/login');
    check(await page.evaluate(()=>new URL(location.href).searchParams.get('next'))===library,'switch account preserves scanned product');
    await fillLogin(f.username);await page.locator('.sl-photo-grid img').first().waitFor();
    check(await page.evaluate(()=>new URL(location.href).searchParams.get('product'))===f.productId,'library reader returns to scanned product');
    await logout();await login(f.readUsername,next);await page.locator('.sample-photo-actions').waitFor();
    check(await page.getByRole('button',{name:'从相册选择',exact:true}).isDisabled(),'production reader cannot start a photo selection');
    check(await page.getByRole('button',{name:'提交审核',exact:true}).isDisabled(),'production reader cannot submit a sample');await shot('capture-readonly');
    await logout();await login(f.captureUsername,next);await page.locator('.sample-photo-actions').waitFor();
    check(await page.getByRole('button',{name:'从相册选择',exact:true}).isEnabled(),'independent capture grant enables ordinary employee photo input');
    const initial=await (await page.request.get(origin+'/api/sample-tasks/code/'+f.captureTaskCode)).json();const count=initial.task.photos.length;
    const mutation='legacy-photo-'+engine;
    // Seed a v245-style failed local photo to test the real upgrade path.
    await page.evaluate(async({code,mutation,engine})=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const c=canvas.getContext('2d');c.fillStyle='#f5efe6';c.fillRect(0,0,640,480);c.fillStyle='#203e56';c.font='30px sans-serif';c.fillText('SAMPLE '+engine,50,200);c.fillText(mutation,50,250);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));const file=new File([blob],'failed-'+engine+'.jpg',{type:'image/jpeg'});
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hongmeng-sample-capture',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('pending-photos'))r.result.createObjectStore('pending-photos');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const t=db.transaction('pending-photos','readwrite');t.objectStore('pending-photos').put({version:2,items:[{id:mutation,mutationId:mutation,file,originalName:file.name,category:'FINISHED',caption:'升级前失败照片',linkedEntryId:'',source:'ALBUM',status:'FAILED',progress:0,error:'当前账号没有执行此操作的权限'}]},'sample-capture:'+code+':photo-queue-v2');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
    },{code:f.captureTaskCode,mutation,engine});
    await page.reload();await page.getByRole('button',{name:'恢复旧草稿',exact:true}).click();await page.locator('article.local').waitFor();
    await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('照片草稿已保存到当前账号的本机空间',{exact:true}).waitFor();
    let q=await queueValue();check(q.length===1&&q[0].mutationId===mutation&&q[0].size>0,'upgrade restores original photo bytes and stable retry identity');await shot('legacy-photo-recovered');
    const photoRoute='**/api/sample-tasks/'+f.captureTaskId+'/photos';
    await page.route(photoRoute,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'当前账号没有执行此操作的权限',code:'PERMISSION_DENIED'})}));
    await page.getByRole('button',{name:'上传全部',exact:true}).click();await page.getByRole('button',{name:'重新检查权限',exact:true}).waitFor();
    check(await page.getByRole('button',{name:'重试',exact:true}).isDisabled(),'revoked permission disables retries and stops upload queue');await shot('capture-permission-changed');
    await page.unroute(photoRoute);await page.getByRole('button',{name:'重新检查权限',exact:true}).click();await page.getByRole('button',{name:'重新检查权限',exact:true}).waitFor({state:'detached'});
    await page.route(photoRoute,route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'登录已失效',code:'SESSION_EXPIRED'})}));
    await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('link',{name:'重新登录并返回'}).waitFor();
    await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('照片草稿已保存到当前账号的本机空间',{exact:true}).waitFor();
    q=await queueValue();check(q.length===1&&q[0].mutationId===mutation,'expired session retains failed local photo');
    const relogin=await page.getByRole('link',{name:'重新登录并返回'}).getAttribute('href');check(await page.evaluate(value=>new URL(value,location.origin).searchParams.get('next'),relogin)===next,'re-login preserves task and photo tab');await shot('capture-login-expired');
    await page.unroute(photoRoute);await logout();await page.goto(origin+relogin);await fillLogin(f.readUsername);await page.locator('.sample-photo-actions').waitFor();
    check(await page.locator('article.local').count()===0,'another employee never inherits the previous account photo queue');
    q=await queueValue();check(q.length===1,'switching employee keeps original owner draft intact');
    await logout();await login(f.captureUsername,next);await page.locator('article.local').waitFor();
    const upload=page.waitForResponse(r=>r.url().endsWith('/api/sample-tasks/'+f.captureTaskId+'/photos')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'重试',exact:true}).click();const response=await upload;check(response.status()===201,'ordinary employee retry uploads the restored photo successfully');
    const result=await response.json();check(result.task.photos.length===count+1,'retry produces exactly one server photo');
    await page.locator('article.local').waitFor({state:'detached'});await page.waitForFunction(()=>[...document.querySelectorAll('article.server img')].some(img=>img.complete&&img.naturalWidth>0));
    check(await page.locator('article.server').count()===count+1,'uploaded photo becomes visible immediately');
    await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('照片草稿已保存到当前账号的本机空间',{exact:true}).waitFor();check((await queueValue()).length===0,'successful upload clears the persisted retry queue');
    for(const width of [360,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'capture fits mobile width '+width);await shot('capture-uploaded-'+width);}
    check(errors.length===0,'no uncaught browser errors');return {ok:true,engine,checks};
  }catch(error){await shot('failure').catch(()=>{});throw Error(error.message+'\nCompleted: '+JSON.stringify(checks)+'\nUI: '+await page.locator('body').ariaSnapshot());}
}
try {
  cli(['open',origin+'/login','--config',config,'--browser',engine,...(engine==='webkit'?['--device','iPhone 13']:[])]);
  writeFileSync(file,`async page => (${scenario.toString()})(page,${JSON.stringify(f)},${JSON.stringify(origin)},${JSON.stringify(dir)},${JSON.stringify(engine)})`);
  const result=cli(['run-code','--filename',file]);writeFileSync(join(dir,'browser-result.txt'),result);
  const match=result.match(/### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/),accepted=match?JSON.parse(match[1].trim()):null;
  if(accepted?.ok!==true||accepted.checks?.length<15)throw Error(result);console.log(result);
}finally{try{cli(['close']);}catch{}rmSync(file,{force:true});}
