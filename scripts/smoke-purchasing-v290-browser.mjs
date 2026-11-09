import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import ExcelJS from 'exceljs';
import {PDFDocument} from 'pdf-lib';
assert.equal(process.env.PURCHASING_QA_ALLOW,'disposable-purchasing-runtime');
const origin=process.env.SMOKE_BASE_URL||'http://127.0.0.1:3290';assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const fixture=JSON.parse(readFileSync(process.env.PURCHASING_V290_FIXTURE||'.local/purchasing-v290-fixture.json','utf8'));
const dir=resolve(process.env.PURCHASING_V290_OUTPUT||'output/playwright/purchasing-v290').replaceAll('\\','/');mkdirSync(dir,{recursive:true});
const generated=join(dir,'browser-code.generated.cjs');
function cli(args){const command=process.platform==='win32'?process.execPath:'npx';const prefix=process.platform==='win32'?[join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js')]:[];
  const r=spawnSync(command,[...prefix,'--yes','--package','@playwright/cli@0.1.19','playwright-cli','-s=purchasing-v290',...args],{encoding:'utf8',timeout:480000});
  const output=((r.stdout||'')+(r.stderr||'')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g,'').replaceAll(fixture.password,'[disposable-password]');
  if(r.error||r.status)throw Error(r.error?.message||output);return output;
}
async function scenario(page,origin,f,dir){
  const checks=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const check=(yes,label)=>{if(!yes)throw Error(label);checks.push(label);};
  const shot=name=>page.screenshot({path:`${dir}/${name}.png`,fullPage:false,animations:'disabled'});
  const request=(path)=>page.evaluate(async path=>{const r=await fetch(path);return{status:r.status,body:await r.json()};},path);
  const record=async id=>(await request('/api/purchases?record='+id)).body.data.record;
  const loadPurchases=async(view='all',extra='')=>{await page.goto(origin+'/workspace/purchases?view='+view);if(extra.includes('history'))await page.getByLabel('跟进条件',{exact:true}).selectOption('history');await page.getByPlaceholder('搜索物品、编号、申请人或供应商').fill(f.marker);await page.waitForFunction(marker=>{const t=document.querySelector('.pc-table-wrap');const rows=[...document.querySelectorAll('tbody tr')];return t?.getAttribute('aria-busy')==='false'&&rows.length>0&&rows.every(r=>r.textContent.includes(marker));},f.marker);};
  const dialog=()=>page.getByRole('dialog');
  const saveDialog=async()=>{const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().split('?')[0]===origin+'/api/purchases');await dialog().getByRole('button',{name:'确认保存',exact:true}).click();const r=await response,b=await r.json();check(r.ok()&&b.ok,'business dialog saved successfully');await dialog().waitFor({state:'detached'});return b.data;};
  const refund=async(button,amount,destination)=>{await button.click();await dialog().waitFor();if(destination)await dialog().getByLabel('实际到账对象').selectOption(destination);await dialog().getByLabel('本次金额（元）',{exact:true}).fill(amount);await dialog().getByLabel('实际收款人 / 单位',{exact:true}).fill(destination==='PERSON'?'测试垫付人':'杭州杭连电子有限公司');await dialog().getByLabel('退款收款账户',{exact:true}).fill(destination==='PERSON'?'QA-PERSON':'QA-COMPANY');await dialog().getByLabel('到账凭证 / 流水号',{exact:true}).fill('QA-'+Date.now());await dialog().getByLabel('退款备注（选填）',{exact:true}).fill('隔离验收到账凭证');await shot('refund-form');await saveDialog();};
  try{
    await page.setViewportSize({width:1366,height:1024});await page.goto(origin+'/login');
    const anonymous=await request('/api/purchases/contracts');check(anonymous.status===401,'contract templates require login');
    await page.goto(origin+'/login?next='+encodeURIComponent('/workspace/purchases'));
    await page.getByLabel('员工编号 / 管理账号').fill(f.user.username);await page.getByLabel('密码',{exact:true}).fill(f.password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(u=>u.pathname==='/workspace/purchases',{timeout:60000});
    await loadPurchases('documents');
    const refundRow=()=>page.locator('tbody tr').filter({hasText:f.lines[0].number});
    check((await refundRow().innerText()).includes('待供应商退款'),'pending supplier refund is visible on the list');
    await refund(refundRow().getByRole('button',{name:'登记退款到账',exact:true}),'40','PERSON');
    let r=await record(f.lines[0].id);check(r.paidCents===10000&&r.refundedCents===0&&r.returns[0].refundedCents===4000,'personal receipt leaves company refund at zero and retains payment');
    await loadPurchases('documents');check((await refundRow().innerText()).includes('待归还公司'),'personal balance remains outstanding on the list');
    await refund(refundRow().getByRole('button',{name:'确认归还公司',exact:true}),'40');
    await loadPurchases('finance','&follow=history');
    await page.locator('tbody tr').filter({hasText:f.marker}).getByRole('button',{name:'查看 →',exact:true}).click();
    await page.getByRole('button',{name:/查看退款及到账操作/}).click();
    await page.getByRole('heading',{name:'退货与退款 / 更正差额',exact:true}).waitFor();
    await refund(page.locator('.pc-log').getByRole('button',{name:'登记退款到账',exact:true}),'60','COMPANY');
    r=await record(f.lines[0].id);check(r.paidCents===10000&&r.refundedCents===10000&&r.returns[0].refunds.length===3,'supplier and personal receipts settle once without altering gross payment');
    check(r.balances[0].onHand===0&&r.receipts[0].quantity===2,'refund receipts preserve stock return and original receipt history');
    await page.getByText('到账记录（3 笔）',{exact:true}).click();await shot('01-refund-audit');
    check((await page.locator('.pc-log').filter({hasText:'到账记录（3 笔）'}).innerText()).includes('QA-COMPANY'),'receipt history exposes actual account and reference');
    await loadPurchases();for(const line of f.lines.slice(1,3))await page.locator('tbody tr').filter({hasText:line.number}).locator('input[type=checkbox]').check();
    await page.locator('.pc-selection').getByRole('button',{name:'请款 / 报销',exact:true}).click();await dialog().waitFor();
    check(await dialog().locator('.pc-funding-table tbody tr').count()===2,'two accounts appear in one compact table');
    check(!/第\s*\d+\s*组|分组申请/.test(await dialog().innerText()),'visible numbered group panels have been removed');
    await dialog().getByLabel(f.lines[1].number+' 本次申请金额',{exact:true}).fill('50');
    await dialog().getByText('统一填写其他信息',{exact:true}).click();await dialog().getByLabel('部分请款 / 收款信息变更说明',{exact:true}).fill('第一笔先申请一半');
    await shot('02-compact-funding');const batch=await saveDialog();check(batch.count===2,'one submit creates correctly separated payment records');
    const funds=await Promise.all(batch.funds.map(x=>record(x.id)));check(funds[0].amountCents===5000&&funds[1].amountCents===10000,'partial request retains unrequested balance');check(new Set(funds.map(x=>x.account)).size===2,'different payee accounts remain separate');
    await page.goto(origin+'/workspace/purchases/contracts/editor?template=1');await page.getByRole('heading',{name:'通用合同模板',exact:true}).waitFor();
    check(await page.getByLabel('需方全称',{exact:true}).inputValue()==='杭州杭连电子有限公司','confirmed legal purchaser is used throughout template');
    await page.getByLabel('模板名称',{exact:true}).fill('采购标准模板 '+f.marker);
    await page.getByLabel('付款方式及期限',{exact:true}).fill('验收合格后30日内支付');
    await page.getByLabel('质保期限',{exact:true}).fill('验收合格之日起12个月');
    await page.getByText('七、违约责任',{exact:true}).click();const breach=page.locator('.ce-clause').filter({hasText:'七、违约责任'});
    await breach.getByLabel('条款正文',{exact:true}).fill('双方按合同履行义务，违约责任以损失证据及双方确认的约定处理。');
    await shot('03-edit-template');await page.getByRole('button',{name:'保存为新模板版本',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('saved')==='1');
    const templateData=(await request('/api/purchases/contracts')).body.data;const revision=templateData.latestRevision;check(templateData.templates[0].content.fields.paymentTerms==='验收合格后30日内支付','edited template saved as a new version');
    const templateDownload=page.waitForEvent('download');await page.getByRole('link',{name:'下载当前已保存的 Excel 模板'}).click();await(await templateDownload).saveAs(dir+'/template.xlsx');
    await page.goto(origin+'/workspace/purchases/contracts/'+f.autoContractId);await page.getByRole('link',{name:'修订合同',exact:true}).waitFor();
    check((await page.locator('.contract-formal').innerText()).includes('采购合同（草稿）'),'automatic purchase contract also uses the complete template as a draft');
    await loadPurchases();await page.locator('tbody tr').filter({hasText:f.lines[3].number}).locator('input[type=checkbox]').check();await page.locator('.pc-selection').getByRole('button',{name:'生成合同',exact:true}).click();await page.getByRole('heading',{name:'编辑本份采购合同',exact:true}).waitFor();
    await page.getByLabel('合同编号',{exact:true}).fill(f.marker+'-CONTRACT');
    const required={'需方统一社会信用代码':'91330100QA00000001','供方统一社会信用代码':'91330100QA00000002','供方地址':'浙江省杭州市隔离测试地址','供方联系人':'测试联系人','供方电话':'0571-00000000','验收期限':'收货后5个工作日内','退款期限':'书面确认后5个工作日','增值税税率（%）':'13','发票类型':'增值税专用发票','开票期限':'交货后7日内','需方指定退款账户':'杭州杭连电子有限公司 / 测试银行 / QA-REFUND'};
    for(const [label,value] of Object.entries(required))await page.getByLabel(label,{exact:true}).fill(value);
    await page.getByRole('button',{name:'预览合同',exact:true}).click();await shot('04-contract-preview');
    check((await page.locator('.contract-formal').innerText()).includes('壹佰元整'),'preview includes exact RMB uppercase total');
    await page.getByRole('button',{name:'确认定稿并保存',exact:true}).click();await page.waitForURL(u=>/^\/workspace\/purchases\/contracts\/(?!editor)[^/]+$/.test(u.pathname));
    const contractId=page.url().split('/').at(-1);const contract=(await request('/api/purchases/contracts?id='+contractId)).body.data;
    check(contract.documentStatus==='FINAL'&&contract.templateRevision===revision&&contract.amountCents===10000,'final contract uses saved template and authoritative purchase amount');
    await shot('05-final-contract');
    for(const [label,file] of [['下载 PDF','contract.pdf'],['下载 Excel','contract.xlsx']]){const event=page.waitForEvent('download');await page.getByRole('link',{name:label,exact:true}).click();const download=await event;await download.saveAs(dir+'/'+file);check(await download.failure()===null,'actual '+file+' download completed');}
    await page.getByRole('link',{name:'修订合同',exact:true}).click();await page.getByLabel('特别约定',{exact:true}).fill('本次修订增加双方确认的验收说明');await page.getByRole('button',{name:'保存合同草稿',exact:true}).click();await page.waitForURL(u=>/^\/workspace\/purchases\/contracts\/(?!editor)[^/]+$/.test(u.pathname));
    const revisionContract=(await request('/api/purchases/contracts?id='+page.url().split('/').at(-1))).body.data;check(revisionContract.revision===2&&revisionContract.documentStatus==='DRAFT','contract edit creates a separate draft revision');
    const preserved=(await request('/api/purchases/contracts?id='+contractId)).body.data;check(JSON.stringify(preserved)===JSON.stringify(contract),'historical final contract remains unchanged after revision');
    await page.goto(origin+'/workspace/warehouse?scope=pool&status=all&q='+f.marker+'&orderId='+f.materialOrderId);await page.locator('.mo-material-line').getByRole('button',{name:'确认到料',exact:true}).waitFor();
    await page.locator('.mo-material-line').getByRole('button',{name:'确认到料',exact:true}).click();const quantity=dialog().getByLabel('本次到料数量（选填）',{exact:true});check(await quantity.getAttribute('required')===null,'arrival quantity has no required browser validation');await quantity.fill('');await shot('06-optional-arrival');await dialog().getByRole('button',{name:'确认到料',exact:true}).click();await dialog().waitFor({state:'detached'});
    const materialPath='/api/warehouse/material-orders/'+f.materialOrderId;let order=(await request(materialPath)).body.order;
    check(order.events[0].arrivals.length===1&&order.events[0].arrivals[0].quantity===null&&order.events[0].usable===0&&order.preparedQuantity===0,'blank arrival saves pending quantity without inventing inventory or prepared products');const arrivalId=order.events[0].arrivals[0].id;
    await page.locator('.mo-material-line').getByRole('button',{name:'补录到料数量',exact:true}).click();await dialog().getByLabel('本次到料数量（选填）',{exact:true}).fill('8');await dialog().getByRole('button',{name:'确认到料',exact:true}).click();await dialog().waitFor({state:'detached'});
    order=(await request(materialPath)).body.order;check(order.events[0].arrivals.length===1&&order.events[0].arrivals[0].id===arrivalId&&order.events[0].usable===8&&order.preparedQuantity===0,'supplement uses original batch and leaves product preparation explicit');await shot('07-arrival-supplemented');
    check(errors.length===0,'no browser runtime errors: '+JSON.stringify(errors));return{passed:true,checks,contractId,templateRevision:revision};
  }catch(error){await shot('failure').catch(()=>{});throw error;}
}
try{
  writeFileSync(generated,`async page=>{const scenario=${scenario.toString()};return scenario(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)});}`);
  cli(['open',origin+'/login']);const output=cli(['run-code','--filename',generated]);writeFileSync(join(dir,'browser-runtime.txt'),output);assert.match(output,/"passed":\s*true/);
  for(const file of ['template.xlsx','contract.xlsx']){const book=new ExcelJS.Workbook();await book.xlsx.readFile(join(dir,file));assert.ok(book.worksheets[0].rowCount>40);assert.equal(book.worksheets[0].getCell('A1').value,'杭州杭连电子有限公司');}
  const pdf=await PDFDocument.load(readFileSync(join(dir,'contract.pdf')));assert.ok(pdf.getPageCount()>=2);
  writeFileSync(join(dir,'browser-result.json'),JSON.stringify({passed:true,pdfPages:pdf.getPageCount(),checks:output},null,2));console.log(output);console.log('Real PDF and both editable Excel downloads verified.');
}finally{rmSync(generated,{force:true});try{cli(['close']);}catch{}}
