import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const origin=process.env.TOOLING_QA_BASE||'http://127.0.0.1:3000';
if(process.env.TOOLING_QA_ALLOW!=='disposable-tooling-runtime'||!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Disposable loopback runtime required');
const fixture=JSON.parse(readFileSync(process.env.TOOLING_QA_FIXTURE,'utf8'));
const dir=process.env.TOOLING_QA_BROWSER_OUTPUT||'artifacts/terminal-tooling/molds-browser';mkdirSync(dir,{recursive:true});
function cli(args){
  const command=process.platform==='win32'?process.execPath:'npx';
  const prefix=process.platform==='win32'?[join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js')]:[];
  const r=spawnSync(command,[...prefix,'--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=terminal-molds-release',...args],{encoding:'utf8',timeout:240000});
  const out=((r.stdout||'')+(r.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(fixture.password,'[disposable-password]');
  if(args[0]==='run-code')writeFileSync(dir+'/browser-runtime.txt',out);
  if(r.error||r.status||/### Error/.test(out))throw Error(r.error?.message||out);return out;
}
// All mutations below target the explicitly guarded disposable image runtime.
async function journey(page,origin,f,dir){
  const checks=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  // The release runtime uses Secure cookies; APIRequestContext needs an explicit
  // Cookie header on the guarded HTTP loopback used by this disposable test.
  let cookie='';
  const call=async(route,body,status=200)=>{const headers={Origin:origin,...(cookie?{Cookie:cookie}:{})};const r=body?await page.request.post(origin+route,{headers,data:body}):await page.request.get(origin+route,{headers});const data=await r.json();check(r.status()===status,route+' '+r.status()+' '+(data.error||''));if(route==='/api/auth/login'){cookie=(r.headers()['set-cookie']||'').match(/hm_session=[^;]+/)?.[0]||'';check(!!cookie,'session cookie issued');}return data;};
  const inventory=()=>call('/api/terminal-tooling/inventory');
  let sequence=0;const key=()=>f.marker+'-'+Date.now()+'-'+(++sequence);
  const work=(data,status)=>call('/api/terminal-tooling/worklog',{key:key(),...data},status);
  const inv=(data,status)=>call('/api/terminal-tooling/inventory',{key:key(),...data},status);
  const press=async(button,endpoint='worklog')=>{const response=page.waitForResponse(r=>r.url().includes('/api/terminal-tooling/'+endpoint)&&r.request().method()==='POST');await button.click();const r=await response,b=await r.json();check(r.ok()&&b.ok,'UI saves '+endpoint+' '+(b.error||''));return b;};
  const layout=async(dialog,label)=>{check(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1;}),label+' fits viewport');check(await dialog.locator('footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),label+' footer visible');};
  const localTime=date=>new Date(+date+8*3600000).toISOString().slice(0,16);
  const model=f.marker+'-ZM',spec=f.marker+'-端子',bladeModel=f.marker+'-组合刀';
  await call('/api/auth/login',{username:f.username,password:f.password});
  const positions=['UPPER_OUTER','UPPER_INNER','LOWER_OUTER','LOWER_INNER'];
  const blade=(await call('/api/terminal-tooling/blades',{model:bladeModel,manufacturer:'镜像验收',isDraft:false,positionSpecs:positions.map(position=>({position,specification:'2.7×2.4',dimensionA:'2.7',dimensionB:'2.4',dimensionUnit:'mm',supplierLinks:[]}))})).blade;
  await inv({action:'REGISTER',bladeId:blade.id,box:7,quantity:1,kind:'KIT'});
  await page.setViewportSize({width:1366,height:1024});await page.goto(origin+'/workspace/terminal-tooling');
  await page.getByRole('button',{name:'刀片 · 专模',exact:true}).click();
  await page.screenshot({path:dir+'/01-desktop-blades.png'});
  await page.getByRole('button',{name:/专模库/}).click();await page.getByRole('button',{name:'新增专模',exact:true}).first().click();
  let dialog=page.getByRole('dialog',{name:'新增专模',exact:true});await dialog.waitFor();await dialog.getByLabel('新专模型号').fill(model);await dialog.getByLabel('专模位置',{exact:true}).selectOption('8');
  check(await dialog.getByText('实物数量 1 套 · 原配刀片随专模管理').isVisible(),'new mold is one physical set without blade form');
  await page.screenshot({path:dir+'/02-new-mold.png'});const created=await press(dialog.getByRole('button',{name:'确认新增',exact:true}),'inventory');await dialog.waitFor({state:'hidden'});
  const moldId=created.moldId;dialog=page.getByRole('dialog',{name:model,exact:true});await dialog.waitFor();await dialog.getByText('库存与使用记录',{exact:true}).click();await dialog.getByText('新增专模',{exact:true}).waitFor();await layout(dialog,'desktop mold drawer');await page.screenshot({path:dir+'/03-mold-detail.png'});await dialog.getByRole('button',{name:'关闭弹窗'}).click();
  check(await page.getByRole('button',{name:'查看专模'+model,exact:true}).isVisible(),'closing mold drawer preserves list');await page.screenshot({path:dir+'/04-molds.png'});
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'/tooling-mobile');await page.getByRole('button',{name:/开始调模/}).click();
  dialog=page.getByRole('dialog',{name:'开始调模',exact:true});await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:'专模调模',exact:true}).click();await dialog.getByLabel('专模型号',{exact:true}).selectOption(moldId);
  check(await dialog.getByLabel('上外刀型号').count()===0,'dedicated mold requires no blade fields');await layout(dialog,'phone dedicated mold');await page.screenshot({path:dir+'/05-phone-mold.png'});
  const first=await press(dialog.getByRole('button',{name:'开始计时',exact:true}));await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'完成作业',exact:true}).waitFor();
  let stock=(await inventory()).molds.find(m=>m.id===moldId);check(stock.state==='IN_USE','live mold allocated once');
  let firstJob=(await call('/api/terminal-tooling/worklog?id='+first.jobId)).job;check(firstJob.toolingMode==='MOLD'&&firstJob.usages.length===0,'dedicated job persists without blades');
  await page.getByRole('button',{name:'完成作业',exact:true}).click();dialog=page.getByRole('dialog',{name:'完成调模',exact:true});await layout(dialog,'phone finish');await press(dialog.getByRole('button',{name:'完成并归还',exact:true}));await dialog.waitFor({state:'hidden'});
  check((await inventory()).molds.find(m=>m.id===moldId).state==='AVAILABLE','default finish returns mold immediately');
  await page.getByRole('button',{name:'返回之前页面',exact:true}).click();await page.getByRole('button',{name:/开始调模/}).click();dialog=page.getByRole('dialog',{name:'开始调模',exact:true});
  await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:spec,exact:true}).click();await dialog.getByLabel('参考记录').waitFor();
  check(await dialog.getByLabel('专模型号',{exact:true}).inputValue()===moldId,'terminal history restores dedicated mold and location');
  await dialog.getByRole('button',{name:'组合调模',exact:true}).click();await dialog.getByRole('button',{name:'添加刀位',exact:true}).click();await dialog.getByLabel('上外刀型号').selectOption(blade.id);check(await dialog.getByText('其余 3 个刀位保持专模原配',{exact:true}).isVisible(),'combination overrides only selected position');
  await layout(dialog,'phone combination');await page.screenshot({path:dir+'/06-phone-combination.png'});const combo=await press(dialog.getByRole('button',{name:'开始计时',exact:true}));await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'完成作业',exact:true}).waitFor();
  let state=await inventory();check(state.blades.find(b=>b.id===blade.id).stock.inUse===1&&state.molds.find(m=>m.id===moldId).state==='IN_USE','combination uses one mold and only one borrowed blade');
  await page.getByRole('button',{name:'返回之前页面',exact:true}).click();await page.getByRole('button',{name:'补录时段',exact:true}).click();dialog=page.getByRole('dialog',{name:'开始调模',exact:true});
  check(await dialog.getByRole('button',{name:/实时计时/}).isDisabled(),'ongoing job prevents second live clock');
  await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:spec,exact:true}).click();await dialog.getByLabel('参考记录').waitFor();
  const start=new Date(Date.now()-3*3600000),end=new Date(+start+30*60000);await dialog.getByLabel('开始时间',{exact:true}).fill(localTime(start));await dialog.getByLabel('结束时间',{exact:true}).fill(localTime(end));await dialog.getByLabel('补录原因',{exact:true}).fill('忘记扫码，补记实际工作');
  await dialog.locator('.tooling-sheet-body').evaluate(el=>el.scrollTop=el.scrollHeight);await layout(dialog,'phone completed backfill');await page.screenshot({path:dir+'/07-phone-backfill.png'});
  const filled=await press(dialog.getByRole('button',{name:'提交补录',exact:true}));await dialog.waitFor({state:'hidden'});const filledJob=(await call('/api/terminal-tooling/worklog?id='+filled.jobId)).job;
  check(filledJob.recordSource==='BACKFILL'&&filledJob.workMs===1800000,'backfill stores 30 minutes with source');state=await inventory();check(state.molds.find(m=>m.id===moldId).inUseJobId===combo.jobId&&state.blades.find(b=>b.id===blade.id).stock.inUse===1,'backfill never releases active mold or borrowed blade');
  await work({action:'BACKFILL',kind:'TUNING',toolingMode:'MOLD',moldId,specification:spec,startedAt:start.toISOString(),endedAt:end.toISOString(),reason:'重复时段检查'},409);
  await page.getByRole('button',{name:'返回之前页面',exact:true}).click();await page.getByRole('button',{name:/继续作业/}).click();await page.getByRole('button',{name:'完成作业',exact:true}).click();dialog=page.getByRole('dialog',{name:'完成调模',exact:true});await dialog.getByLabel('专模原配刀片已装回').uncheck();await page.screenshot({path:dir+'/08-phone-return.png'});await press(dialog.getByRole('button',{name:'完成并记录去向',exact:true}));await dialog.waitFor({state:'hidden'});
  state=await inventory();stock=state.molds.find(m=>m.id===moldId);check(stock.state==='RESTORE'&&state.blades.find(b=>b.id===blade.id).stock.inUse===0,'unrestored mold stays unavailable while borrowed blade returns');
  await work({action:'START',kind:'TUNING',toolingMode:'MOLD',moldId,specification:spec},409);
  await page.setViewportSize({width:1366,height:1024});await page.goto(origin+'/workspace/terminal-tooling');await page.getByRole('button',{name:'刀片 · 专模',exact:true}).click();await page.getByRole('button',{name:/专模库/}).click();await page.getByRole('button',{name:'查看专模'+model,exact:true}).click();dialog=page.getByRole('dialog',{name:model,exact:true});await dialog.getByRole('button',{name:'归还 / 恢复原配',exact:true}).click();dialog=page.getByRole('dialog',{name:'确认归还与复原',exact:true});await dialog.getByLabel('专模已恢复原配，外借刀片已归还').check();await press(dialog.getByRole('button',{name:'确认保存',exact:true}),'inventory');await dialog.waitFor({state:'hidden'});check((await inventory()).molds.find(m=>m.id===moldId).state==='AVAILABLE','explicit restoration enables next use');
  await page.getByRole('dialog',{name:model,exact:true}).getByRole('button',{name:'关闭弹窗'}).click();await page.getByRole('button',{name:'补录时段',exact:true}).click();dialog=page.getByRole('dialog',{name:'开始调模',exact:true});await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:spec,exact:true}).click();await dialog.getByLabel('参考记录').waitFor();await dialog.getByRole('button',{name:'专模调模',exact:true}).click();await dialog.getByLabel('专模型号',{exact:true}).selectOption(moldId);await dialog.getByRole('button',{name:'仍在进行',exact:true}).click();await dialog.getByLabel('开始时间',{exact:true}).fill(localTime(new Date(Date.now()-20*60000)));await dialog.getByLabel('补录原因',{exact:true}).fill('开始时忘记点击');
  // That interval overlaps the just-finished work and must remain editable.
  const denied=page.waitForResponse(r=>r.url().includes('/api/terminal-tooling/worklog')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'补记开始并继续计时',exact:true}).click();check((await denied).status()===409,'backstart overlap rejected');check(await dialog.isVisible(),'invalid period stays editable');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  // A separate collaborator has no overlapping work and can backdate an active start.
  if(f.members){await call('/api/auth/login',{username:f.members.COLLABORATE.username,password:f.password});await page.setViewportSize({width:390,height:844});await page.goto(origin+'/tooling-mobile');await page.getByRole('button',{name:'补录时段',exact:true}).click();dialog=page.getByRole('dialog',{name:'开始调模',exact:true});await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:spec,exact:true}).click();await dialog.getByLabel('参考记录').waitFor();await dialog.getByRole('button',{name:'专模调模',exact:true}).click();await dialog.getByLabel('专模型号',{exact:true}).selectOption(moldId);await dialog.getByRole('button',{name:'仍在进行',exact:true}).click();await dialog.getByLabel('开始时间',{exact:true}).fill(localTime(new Date(Date.now()-15*60000)));await dialog.getByLabel('补录原因',{exact:true}).fill('上班漏点开始');await dialog.locator('.tooling-sheet-body').evaluate(el=>el.scrollTop=el.scrollHeight);await layout(dialog,'phone backdated active start');await page.screenshot({path:dir+'/09-phone-backstart.png'});const started=await press(dialog.getByRole('button',{name:'补记开始并继续计时',exact:true}));await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'完成作业',exact:true}).waitFor();await page.screenshot({path:dir+'/10-phone-running.png'});check((await call('/api/terminal-tooling/worklog?id='+started.jobId)).job.recordSource==='BACKSTART','collaborator can backstart own job');await page.getByRole('button',{name:'完成作业',exact:true}).click();dialog=page.getByRole('dialog',{name:'完成调模',exact:true});await press(dialog.getByRole('button',{name:'完成并归还',exact:true}));await dialog.waitFor({state:'hidden'});}
  await call('/api/auth/login',{username:f.username,password:f.password});await page.setViewportSize({width:1366,height:1024});await page.goto(origin+'/workspace/terminal-tooling');await page.getByRole('button',{name:'工时统计',exact:true}).click();await page.getByRole('button',{name:'周',exact:true}).click();await page.getByRole('button',{name:'月',exact:true}).click();await page.getByLabel('筛选记录来源').selectOption('BACKFILL');
  const exportWait=page.waitForEvent('download');await page.getByRole('link',{name:'导出 CSV',exact:true}).click();const download=await exportWait;await download.saveAs(dir+'/backfill-worklog.csv');check((await page.request.get(origin+await page.getByRole('link',{name:'导出 CSV',exact:true}).getAttribute('href'),{headers:{Cookie:cookie}})).status()===200,'filtered CSV export works');await page.screenshot({path:dir+'/11-desktop-statistics.png'});
  await page.setViewportSize({width:360,height:740});await page.goto(origin+'/tooling-mobile');await page.getByRole('button',{name:'查看记录',exact:true}).click();check(await page.locator('.tl-filters').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'phone statistics filters fit 360 width');await page.screenshot({path:dir+'/12-phone-statistics.png'});
  if(f.members){await call('/api/auth/login',{username:f.members.READ.username,password:f.password});await page.goto(origin+'/tooling-mobile');check(await page.getByRole('button',{name:/开始调模/}).count()===0,'readonly account has lookup without create');await work({action:'START',kind:'TUNING',toolingMode:'MOLD',moldId,specification:spec},403);await inv({action:'MOLD_CREATE',model:model+'-forbidden',position:20},403);await page.getByRole('button',{name:/查端子与刀片/}).click();dialog=page.getByRole('dialog',{name:'查端子与工装',exact:true});await dialog.getByLabel('端子型号',{exact:true}).fill(spec);await dialog.getByRole('button',{name:spec,exact:true}).click();await dialog.getByLabel('参考记录').waitFor();check(await dialog.getByLabel('专模型号',{exact:true}).inputValue()===moldId,'readonly history lookup includes mold');}
  check(errors.length===0,'no browser runtime errors');return {passed:true,checks,errors};
}
const codeFile=dir+'/browser-code.generated.cjs';
try{writeFileSync(dir+'/initial-snapshot.txt',cli(['open',origin+'/login']));writeFileSync(codeFile,`async page => await (${journey.toString()})(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)})`);console.log(cli(['run-code','--filename',codeFile]));}
finally{writeFileSync(codeFile,'// Disposable browser input cleared.\n');try{cli(['close']);}catch{}}
