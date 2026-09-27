// Executed by the existing guarded Playwright CLI harness against a disposable runtime.
async function scenario(page, origin, f, dir) {
  const checks=[], errors=[];
  page.on('pageerror', error=>errors.push(String(error)));
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const api=(path,method='GET',data)=>page.evaluate(async ({path,method,data})=>{
    const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
    return {status:r.status,body:await r.json().catch(()=>({}))};
  },{path,method,data});
  const read=async()=>{const r=await api('/api/warehouse/material-orders/'+f.warehouseTaskId);check(r.status===200,'order detail readable');return r.body.order;};
  const shot=async name=>{
    if(name!=='failure' && await page.locator('.mo-queue').count()) {
      await page.waitForFunction(()=>!document.querySelector('.mo-queue h3 small')?.textContent.includes('—'));
    }
    return page.screenshot({path:dir+'/'+name+'.png',fullPage:false});
  };
  const login=async(kind,target)=>{
    await page.context().clearCookies(); await page.goto(origin+'/login?next='+encodeURIComponent(target));
    await page.getByLabel('员工编号 / 管理账号').fill(f.users[kind].username);
    await page.getByLabel('密码',{exact:true}).fill(f.password);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.waitForURL(url=>url.pathname===target.split('?')[0],{timeout:30000});
    await page.waitForLoadState('domcontentloaded');
  };
  const submit=async(name)=>{const d=page.getByRole('dialog');await d.getByRole('button',{name,exact:true}).click();await d.waitFor({state:'detached',timeout:15000});};
  const target='/workspace/warehouse?orderId='+f.warehouseTaskId+'&q='+f.marker;
  try {
    await page.setViewportSize({width:1366,height:1024});
    await login('warehouse',target);
    await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor();
    const queue=await api('/api/warehouse/material-orders?scope=current&status=all&q='+f.marker);
    check(queue.status===200&&queue.body.orders.some(o=>o.id===f.warehouseTaskId),'weekly queue returns the registered order: '+JSON.stringify(queue.body.error||queue.body.pagination||queue.body));
    await page.locator('.mo-order-row').filter({hasText:f.workOrder.specification}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'登记缺料',exact:true}).click();
    await page.getByLabel('缺料型号',{exact:true}).fill('TERM-A');
    await page.getByLabel('登记缺料数量',{exact:true}).fill('5');
    await submit('登记缺料');
    await page.locator('.mo-material-line').filter({hasText:'TERM-A'}).waitFor();
    let order=await read(); const eid=order.events[0].id;
    check(order.openCount===1&&order.events[0].source==='PURCHASED','purchased item registered on same order');
    check(await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).count()===1,'register returns to same order without homepage navigation');
    await page.getByLabel('本单进展').fill('保留草稿');
    await page.reload(); await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[aria-label="本单进展"]')?.value==='保留草稿');
    await page.getByRole('button',{name:'保存进展',exact:true}).click();
    await page.getByRole('status').waitFor();
    await shot('warehouse-order-1366x1024');
    await page.getByRole('link',{name:'物料追踪',exact:true}).click();
    await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor();
    await page.getByRole('link',{name:'返回来源',exact:true}).click();
    await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor();
    check(await page.evaluate(()=>new URL(location.href).searchParams.get('q'))===f.marker,'cross-module return retains order and search');
    await login('operator','/workspace/procurement?orderId='+f.warehouseTaskId);
    await page.locator('.mo-material-line').filter({hasText:'TERM-A'}).waitFor();
    check(await page.getByRole('button',{name:/接收|分配|负责人/}).count()===0,'department collaboration has no personal claim gate');
    await page.locator('.mo-material-line').first().getByRole('button',{name:'登记发货',exact:true}).click();
    await page.getByLabel('本批数量',{exact:true}).fill('2');
    await page.getByLabel('物流公司',{exact:true}).fill('顺丰');
    await page.getByLabel('快递单号',{exact:true}).fill('SF-ACCEPTANCE-001');
    await submit('登记发货');
    await page.locator('.mo-material-line').first().getByRole('button',{name:'登记到料',exact:true}).click();
    await submit('登记到料');
    order=await read();
    check(order.events[0].pending===2&&order.events[0].usable===0&&order.state==='SHORTAGE','partial reported arrival never becomes usable or kitted');
    const denied=await api('/api/warehouse/material-orders/'+order.id,'PATCH',{action:'verify_arrival',version:order.version,requestKey:f.marker+'-denied-verify',exceptionId:eid,arrivalId:order.events[0].arrivals[0].id,acceptedQuantity:2});
    check(denied.status===403,'procurement cannot self-verify warehouse receipts');
    await login('warehouse',target);
    await page.locator('.mo-material-line').first().getByRole('button',{name:'核验本批',exact:true}).click();
    await page.getByLabel('核验可用数量',{exact:true}).fill('1');
    await page.getByLabel('备注',{exact:true}).fill('一件错料，继续补货');
    await shot('verify-arrival-dialog-1366x1024');
    await submit('核验本批');
    order=await read();check(order.events[0].usable===1&&order.events[0].remaining===4,'rejected units remain in missing quantity');
    await page.getByRole('button',{name:'直接登记到料',exact:true}).click();
    await page.getByLabel('本批数量',{exact:true}).fill('4');
    await page.getByLabel('物流方式',{exact:true}).selectOption('SELF_DELIVERY');
    await submit('登记到料');
    await page.locator('.mo-material-line').first().getByRole('button',{name:'核验本批',exact:true}).click();
    await submit('核验本批');
    order=await read();check(order.state==='CONFIRM','all shortages resolved still awaits whole-order physical confirmation');
    await page.getByRole('button',{name:'确认整单配齐',exact:true}).click();
    await page.getByRole('checkbox',{name:'已核对该订单所需实物，确认物料齐全'}).check();
    await submit('确认整单配齐');
    order=await read();check(order.state==='READY','warehouse completes the whole order');
    await page.goto(origin+'/workspace/warehouse?status=ready&q='+f.marker);
    await page.locator('.mo-order-row').filter({hasText:f.workOrder.specification}).waitFor();
    await page.getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor({timeout:20000});
    check((await read()).state==='READY','completed order remains visible in completed queue');
    await login('reader','/workspace/procurement?orderId='+f.visual.warehouseTaskId);
    await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
    check(await page.getByRole('button',{name:'登记缺料',exact:true}).count()===0,'read-only mode has no mutation actions');
    const forbidden=await api('/api/warehouse/material-orders/'+f.warehouseTaskId,'PATCH',{action:'note',requestKey:f.marker+'-readonly-note',note:'readonly mutation'});
    check(forbidden.status===403,'read-only is enforced at API');
    await login('admin','/weekly-plan-center');
    await page.getByRole('button',{name:'查看 '+f.workOrder.specification+' 配料明细',exact:true}).waitFor({timeout:30000});
    const planURL=page.url();
    await page.getByRole('button',{name:'查看 '+f.workOrder.specification+' 配料明细',exact:true}).click();
    await page.getByRole('dialog',{name:'周订单物料明细'}).getByRole('heading',{name:f.workOrder.specification,exact:true}).waitFor();
    check(await page.getByRole('dialog',{name:'周订单物料明细'}).getByText('已配齐',{exact:true}).count()>0,'planning drawer reflects warehouse physical completion');
    await shot('plan-material-drawer-1366x1024');
    await page.getByRole('button',{name:'关闭订单缺料',exact:true}).click();
    check(page.url()===planURL,'plan drawer closes without changing route or plan selection');
    await page.goto(origin+'/workspace/warehouse?orderId='+f.visual.warehouseTaskId+'&status=all');
    await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
    await shot('warehouse-week-orders-1366x1024');
    await page.goto(origin+'/workspace/procurement?orderId='+f.visual.warehouseTaskId+'&status=all');
    await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
    await shot('tracking-week-orders-1366x1024');
    for(const height of [1024,768]) {
      await page.setViewportSize({width:1366,height});
      const geometry=await page.evaluate(()=>{
        const body=document.documentElement, main=document.querySelector('.mo-workbench'), panel=document.querySelector('.mo-detail-scroll'), footer=document.querySelector('.mo-compose');
        return {scroll:body.scrollHeight-innerHeight,width:body.scrollWidth-innerWidth,main:main.getBoundingClientRect().height,panel:panel.clientHeight,footer:footer.getBoundingClientRect().bottom};
      });
      check(geometry.scroll<3&&geometry.width<3&&geometry.panel>230&&geometry.footer<=height,'single viewport and usable inner scroll '+height+': '+JSON.stringify(geometry));
      await shot('tracking-week-orders-1366x'+height);
    }
    await page.locator('.mo-detail-scroll').evaluate(el=>el.scrollTop=120);
    await page.waitForFunction(()=>document.querySelector('.mo-detail-scroll').scrollTop>=100);
    await page.getByRole('link',{name:'仓库配料',exact:true}).click();
    await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
    await page.getByRole('link',{name:'返回来源',exact:true}).click();
    await page.getByRole('heading',{name:f.visual.specification,exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.mo-detail-scroll').scrollTop>=100);
    check(true,'cross-module return restores detail scroll position');
    await page.getByRole('button',{name:/历史未结/}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('scope')==='overdue');
    await page.locator('.mo-order-row').first().waitFor();
    const older=(await api('/api/warehouse/material-orders?scope=overdue&view=tracking')).body;
    check(older.orders.length>0&&older.orders.every(o=>o.weekStart<older.currentWeek),'historical open orders retain original weekly identity');
    await page.getByRole('button',{name:/^下周/}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('scope')==='next');
    await page.locator('.mo-order-row').first().waitFor();
    check(errors.length===0,'no uncaught browser errors: '+errors.join(';'));
    return {passed:true,checks};
  } catch(error) {await shot('failure');throw error;}
}
