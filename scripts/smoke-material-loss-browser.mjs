import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
assert.equal(process.env.MATERIAL_LOSS_QA_ALLOW, 'disposable-material-loss-runtime');
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3292';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const fixture = JSON.parse(readFileSync(process.env.MATERIAL_LOSS_FIXTURE || '.local/material-loss-fixture.json', 'utf8'));
const dir = resolve(process.env.MATERIAL_LOSS_OUTPUT || 'output/playwright/material-loss').replaceAll('\\', '/'); mkdirSync(dir, { recursive: true });
const generated = join(dir, 'browser-code.generated.cjs');
if (process.env.MATERIAL_LOSS_RESUME_ID) fixture.resumeLossId = process.env.MATERIAL_LOSS_RESUME_ID;
fixture.resumeStage = process.env.MATERIAL_LOSS_RESUME_STAGE || '';
writeFileSync(join(dir,'fixture.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx', prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const r = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=material-loss-v292', ...args], { encoding: 'utf8', timeout: 480000 });
  const output = ((r.stdout || '') + (r.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (r.error || r.status) throw Error(r.error?.message || output); return output;
}
async function scenario(page, origin, f, dir) {
  const checks = [], errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.setDefaultTimeout(45000);
  const check = (yes, label) => { if (!yes) throw Error(label); checks.push(label); };
  const shot = name => page.screenshot({ path: `${dir}/${name}.png`, fullPage: false, animations: 'disabled' });
  const api = (path, data) => page.evaluate(async ({ path, data }) => { const r = await fetch(path, data ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); return { status: r.status, body: await r.json() }; }, { path, data });
  const lossDialog = () => page.locator('.ml-dialog');
  const arrival = () => page.locator('.mo-dialog');
  const waitLoss = async id => { await page.locator('.ml-detail-title').waitFor(); await page.waitForFunction(id => location.search.includes(id), id); };
  async function login(name, target = '/workspace/material-loss') {
    await page.context().clearCookies(); await page.goto(origin + '/login?next=' + encodeURIComponent(target));
    await page.getByLabel('员工编号 / 管理账号').fill(f.users[name].username); await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.waitForURL(u => u.pathname !== '/login'); await page.goto(origin + target);
  }
  async function confirmLoss() { const response = page.waitForResponse(r => r.url().includes('/api/material-loss/') && r.request().method() === 'PATCH'); await lossDialog().getByRole('button', { name: '确认', exact: true }).click(); const r = await response, b = await r.json(); check(r.ok() && b.ok, 'loss command saved'); await lossDialog().waitFor({ state: 'detached' }); return b.record; }
  async function verifyAccountPermissions(){
    await login('admin','/workspace/employees');
    await page.getByRole('button',{name:'账号管理',exact:true}).click();
    const accounts=page.getByRole('dialog',{name:'账号与访问管理',exact:true});await accounts.waitFor();
    await accounts.getByLabel('搜索员工账号').fill(f.users.reporter.name);await accounts.locator('.aa-account').filter({hasText:f.users.reporter.name}).click();
    await accounts.getByLabel('搜索小模块',{exact:true}).fill('物料损耗');
    check(await accounts.getByLabel('物料损耗申报设为协同',{exact:true}).getAttribute('aria-pressed')==='true','account editor restores the independent declaration grant');
    check(await accounts.getByLabel('物料损耗审批设为未开通',{exact:true}).getAttribute('aria-pressed')==='true','approval is not implicitly granted with declaration');
    await accounts.getByLabel('物料损耗申报设为只读',{exact:true}).click();await accounts.getByLabel('物料损耗审批设为协同',{exact:true}).click();
    const accessSave=page.waitForResponse(r=>r.url().endsWith('/api/users/module-access')&&r.request().method()==='POST');
    await accounts.getByRole('button',{name:'保存配置',exact:true}).click();const grantResponse=await accessSave,grantBody=await grantResponse.json();
    check(grantResponse.ok()&&grantBody.user.moduleAccess.permissions['material-loss-report']==='READ'&&grantBody.user.moduleAccess.permissions['material-loss-approval']==='COLLABORATE'&&grantBody.user.moduleAccess.permissions.warehouse==='COLLABORATE','account UI saves both permissions independently and preserves warehouse access');
    await shot('06-independent-account-permissions');
    await login('reporter','/workspace/material-loss');await page.locator('.ml-intro').waitFor();
    check(await page.getByRole('button',{name:'申报损耗',exact:true}).count()===0,'changed declaration permission immediately removes write actions');
    await page.goto(origin+'/workspace/procurement');await page.getByRole('navigation',{name:'物料模块',exact:true}).waitFor();
    check(await page.locator('.mo-top').evaluate(el=>el.scrollWidth<=el.clientWidth+2),'material tracking tabs fit the horizontal tablet');await shot('07-material-module-tabs');
  }
  try {
    await page.setViewportSize({ width: 1366, height: 1024 }); await page.goto(origin + '/login');
    check((await api('/api/material-loss')).status === 401, 'loss ledger requires login');
    if(f.resumeStage==='accounts'){await verifyAccountPermissions();check(errors.length===0,'no browser runtime errors');return{passed:true,checks};}
    let created, order;
    if(f.resumeLossId){await login('reporter','/workspace/material-loss?id='+f.resumeLossId);created={id:f.resumeLossId};await waitLoss(created.id);}
    else {
    await login('reporter', '/workspace/warehouse?branch=samples&taskId=' + f.sampleId);
    await page.getByRole('button', { name: '核对缺料后确认配齐', exact: true }).waitFor();
    check(await page.getByRole('button', { name: '核对缺料后确认配齐', exact: true }).isEnabled(), 'sample kitting action is accessible with unresolved shortage');
    await page.getByRole('button', { name: '核对缺料后确认配齐', exact: true }).click();
    await page.locator('.sw-arrival-dialog .mo-compose').waitFor();
    check(await page.locator('.sw-arrival-dialog .mo-material-line').count()>0,'sample shortage action opens the shared physical verification in place');
    await page.locator('.sw-arrival-dialog>header').getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.locator('.sw-shortage-table').getByRole('button', { name: '确认已到料', exact: true }).waitFor();
    check(!(await page.locator('.sw-main').innerText()).includes('GMT+0000'), 'sample list and header normalize the legacy date and flag the customer');
    await page.getByLabel('搜索样品配料',{exact:true}).fill(f.marker);
    await page.waitForResponse(r=>r.url().includes('/api/warehouse/sample-tasks?')&&r.url().includes('keyword='+f.marker));
    await page.getByRole('navigation',{name:'配料状态',exact:true}).getByRole('button',{name:/^缺料/}).click();
    await page.waitForFunction(()=>document.querySelector('.sw-workspace')?.getAttribute('aria-busy')==='false');
    await shot('01-sample-action');
    await page.locator('.sw-shortage-table').getByRole('button', { name: '确认已到料', exact: true }).click();
    await arrival().getByLabel('本次到料数量（选填）', { exact: true }).fill('');
    await arrival().getByRole('button', { name: '确认到料', exact: true }).click(); await arrival().waitFor({ state: 'detached' });
    order = (await api('/api/warehouse/material-orders/' + f.warehouseId)).body.order;
    check(order.events[0].arrivals.length === 1 && order.events[0].arrivals[0].quantity === null && order.events[0].usable === 0, 'sample blank arrival saves pending quantity without inventing facts');
    const arrivalId = order.events[0].arrivals[0].id;
    await page.locator('.mo-material-line').getByRole('button', { name: '补录到料数量', exact: true }).click();
    await arrival().getByLabel('本次到料数量（选填）', { exact: true }).fill('3'); await arrival().getByRole('button', { name: '确认到料', exact: true }).click(); await arrival().waitFor({ state: 'detached' });
    order = (await api('/api/warehouse/material-orders/' + f.warehouseId)).body.order;
    check(order.events[0].usable === 3 && order.events[0].arrivals[0].id === arrivalId, 'sample quantity supplementation updates the original batch');
    await page.locator('.mo-compose').getByRole('button', { name: '确认整单配齐', exact: true }).click();
    await arrival().getByRole('checkbox').check(); await arrival().getByRole('button', { name: '确认整单配齐', exact: true }).click(); await arrival().waitFor({ state: 'detached' });
    await page.locator('.sw-arrival-dialog>header').getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sw-state-actions')?.textContent.includes('已配齐'));
    check(page.url().includes('branch=samples'), 'sample completion stays in the sample workspace'); await shot('02-sample-completed');
    await page.getByRole('link', { name: '申报物料损耗', exact: true }).click(); await lossDialog().waitFor();
    const fields = { '物料名称': '验收连接器', '规格型号': f.marker + '-LOSS', '损耗单位': '个', '损耗数量': '3.25', '具体损耗原因': f.marker + ' 调机压接损耗，已留存现场照片' };
    for (const [name, value] of Object.entries(fields)) await lossDialog().getByLabel(name, { exact: true }).fill(value);
    await lossDialog().getByLabel('物料来源', { exact: true }).selectOption('CUSTOMER');
    await lossDialog().getByLabel('影响关联订单配齐，提示仓库核对', { exact: true }).check();
    await lossDialog().getByLabel('需要补料', { exact: true }).check(); await lossDialog().getByLabel('补料数量', { exact: true }).fill('4');
    await shot('03-loss-declaration');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/material-loss') && r.request().method() === 'POST');
    await lossDialog().getByRole('button', { name: '保存草稿', exact: true }).click(); created = (await (await saved).json()).record; await lossDialog().waitFor({ state: 'detached' }); await waitLoss(created.id);
    }
    let row;
    if(f.resumeStage==='approved'){await login('reviewer','/workspace/material-loss?id='+f.resumeLossId);await waitLoss(f.resumeLossId);row=(await api('/api/material-loss/'+f.resumeLossId)).body.record;}
    else {
    const uploaded = page.waitForResponse(r => r.url().includes('/attachments') && r.request().method() === 'POST');
    await page.locator('.ml-detail input[type=file]').setInputFiles(dir + '/fixture.png'); check((await uploaded).ok(), 'loss attachment uploads to object storage');
    await page.getByRole('link', { name: 'fixture.png', exact: true }).waitFor(); const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'fixture.png', exact: true }).click(); await (await download).saveAs(dir + '/attachment.png');
    await page.locator('.ml-actions').getByRole('button', { name: '提交审批', exact: true }).click(); row = await confirmLoss();
    const forbidden = await api('/api/material-loss/' + row.id, { action: 'approve', version: row.version, requestKey: f.marker+'-denied-'+Date.now() }); check(forbidden.status === 403, 'reporter cannot approve through a direct API call');
    await login('reader', '/workspace/material-loss?id=' + row.id); await waitLoss(row.id);
    check(await page.getByRole('button', { name: '申报损耗', exact: true }).count() === 0, 'read-only account has no declaration action');
    check((await api('/api/material-loss/' + row.id, { action: 'approve', version: row.version, requestKey: f.marker+'-denied-'+Date.now() })).status === 403, 'read-only writes are rejected');
    await login('reviewer', '/workspace/material-loss?id=' + row.id); await waitLoss(row.id);
    check(await page.getByRole('button', { name: '申报损耗', exact: true }).count() === 0, 'approval-only account has no declaration action');
    await page.locator('.ml-actions').getByRole('button', { name: '同意损耗', exact: true }).click(); await lossDialog().getByLabel('操作说明', { exact: true }).fill('确认原因与数量，按客供补料跟进'); row = await confirmLoss();
    check(row.status === 'APPROVED' && row.replenishment?.quantity === '4', 'approval creates exactly one independent replenishment task'); await shot('04-approved-loss');
    }
    const notifications = (await api('/api/notifications?state=completed')).body; check(JSON.stringify(notifications).includes('MATERIAL_LOSS'), 'in-app approval notification remains traceable');
    await login('reporter', '/workspace/warehouse?branch=samples&taskId=' + f.sampleId);
    await page.getByRole('button', { name: '核对损耗后的实物', exact: true }).click(); await page.getByRole('button', { name: '登记实物复核', exact: true }).click();
    await arrival().getByRole('checkbox').check(); await arrival().getByLabel('备注', { exact: true }).fill('实物已复核，备用物料可满足本样品，客供补料继续跟进');
    await arrival().getByRole('button', { name: '登记损耗实物复核', exact: true }).click(); await arrival().waitFor({ state: 'detached' });
    order = (await api('/api/warehouse/material-orders/' + f.warehouseId)).body.order;
    check(order.materialLossWarnings.length === 0 && order.status === 'completed', 'warehouse review clears warning without reversing prior kitting');
    await page.goto(origin + '/workspace/material-loss?id=' + row.id); await waitLoss(row.id);
    await page.getByRole('button', { name: '登记进展 / 核验补料', exact: true }).click(); await lossDialog().getByLabel('累计可用到料数量', { exact: true }).fill('4'); await lossDialog().getByLabel('本次补料全部完成', { exact: true }).check(); await lossDialog().getByLabel('已核对实物，累计可用数量准确', { exact: true }).check(); await lossDialog().getByLabel('操作说明', { exact: true }).fill('客供补料 4 个实收并核验可用'); row = await confirmLoss(); check(row.replenishment.status === 'COMPLETED', 'physical replenishment can be completed independently');
    await page.locator('.ml-actions').getByRole('button', { name: '发起更正', exact: true }).click(); await confirmLoss(); await lossDialog().getByLabel('损耗数量', { exact: true }).fill('2.5'); await lossDialog().getByLabel('更正原因', { exact: true }).fill('复核计量后为 2.5 个计量单位，补料记录保持原样');
    await lossDialog().getByRole('button', { name: '保存并提交审批', exact: true }).click(); await lossDialog().waitFor({ state: 'detached' }); const correctionId = await page.evaluate(()=>new URL(location.href).searchParams.get('id'));
    await login('reviewer', '/workspace/material-loss?id=' + correctionId); await waitLoss(correctionId); await page.locator('.ml-actions').getByRole('button', { name: '同意损耗', exact: true }).click(); const correction = await confirmLoss();
    check(correction.quantity === '2.5' && correction.replenishment.id === row.replenishment.id && correction.replenishment.receivedQuantity === '4', 'approved correction retains the original replenishment and updates loss statistics');
    await page.getByLabel('搜索物料损耗', { exact: true }).fill(f.marker + '-LOSS'); await page.waitForFunction(() => document.querySelector('.ml-list')?.getAttribute('aria-busy') === 'false' && document.querySelector('.ml-intro')?.textContent.includes('2.5 个'));
    const exported = page.waitForEvent('download'); await page.getByRole('button', { name: '导出筛选结果', exact: true }).click(); await (await exported).saveAs(dir + '/material-loss.csv');
    await shot('05-loss-correction-ledger');
    await page.reload(); await waitLoss(correctionId); check((await page.locator('.ml-detail').innerText()).includes('2.5'), 'saved results survive a browser reload');
    await verifyAccountPermissions();
    check(errors.length === 0, 'no browser runtime errors: ' + JSON.stringify(errors));
    return { passed: true, checks, lossId: row.id, correctionId };
  } catch (error) { await shot('failure').catch(() => {}); throw error; }
}
try {
  writeFileSync(generated, `async page=>{const scenario=${scenario.toString()};return scenario(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)});}`);
  cli(['open', origin + '/login']); const output = cli(['run-code', '--filename', generated]); writeFileSync(join(dir, 'browser-runtime.txt'), output); assert.match(output, /"passed":\s*true/);
  assert.equal(readFileSync(join(dir, 'attachment.png')).subarray(1, 4).toString(), 'PNG');
  const csv = readFileSync(join(dir, 'material-loss.csv'), 'utf8'); assert.ok(csv.includes('统计有效') && csv.includes('2.5') && csv.includes(fixture.marker));
  writeFileSync(join(dir, 'browser-result.json'), JSON.stringify({ passed: true, checks: output, realAttachmentAndCsvDownloads: true }, null, 2)); console.log(output);
} finally { rmSync(generated, { force: true }); try { cli(['close']); } catch {} }
