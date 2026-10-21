import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

assert.equal(process.env.PURCHASING_QA_ALLOW, 'disposable-purchasing-runtime');
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3274';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const f = JSON.parse(readFileSync(process.env.PURCHASING_IMPROVEMENTS_FIXTURE || 'output/playwright/purchasing-improvements/fixture.json', 'utf8').replace(/^\uFEFF/, ''));
assert.ok(f.marker.startsWith('PCQ-') && f.fundIds.length === 2);
const dir = resolve(process.env.BATCH_KNOWLEDGE_OUTPUT || 'output/playwright/batch-knowledge-local').replaceAll('\\', '/');
mkdirSync(dir, { recursive: true });
const generated = join(dir, 'browser-code.generated.cjs');
const fixtureDir = resolve('tests/fixtures/knowledge-office');
for (const ext of ['xls', 'xlsx', 'doc', 'docx']) copyFileSync(join(fixtureDir, `knowledge.${ext}`), join(dir, `${f.marker}-资料.${ext}`));
const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic batch payment receipt');
writeFileSync(join(dir, 'receipt.pdf'), await pdf.save());
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=batch-knowledge', ...args], { encoding: 'utf8', timeout: 480000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(f.password, '[disposable-password]');
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}
async function scenario(page, origin, f, dir) {
  const checks = [], errors = [];
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && !(message.text().includes('net::ERR_FAILED') && message.location().url.includes('/api/knowledge/attachments/upload'))) errors.push(message.text());
  });
  const shot = name => page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
  const rows = async (count = 2) => page.waitForFunction(({ marker, count }) => {
    const records = [...document.querySelectorAll('.pc-table-wrap tbody tr')];
    return records.length === count && records.every(row => row.textContent.includes(marker));
  }, { marker: f.marker, count });
  try {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto(origin + '/login?next=' + encodeURIComponent('/workspace/purchases?view=finance'));
    await page.getByLabel('员工编号 / 管理账号').fill(f.user.username);
    await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/workspace/purchases');
    await page.getByPlaceholder('搜索物品、编号、申请人或供应商').fill(f.marker); await rows();
    await page.getByLabel('选择当前页全部记录').check();
    await page.getByRole('button', { name: '批量登记打款（2 笔）', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '批量登记打款', exact: true });
    await dialog.waitFor();
    const first = dialog.locator('.pc-batch-payment-row').filter({ hasText: '¥300.00' });
    const second = dialog.locator('.pc-batch-payment-row').filter({ hasText: '¥200.00' });
    await second.getByLabel(/本次付款金额/).fill('100');
    await dialog.getByLabel('统一公司付款账户', { exact: true }).fill('验收公司账户');
    await dialog.getByLabel('统一银行流水号（同一笔转账时填写）', { exact: true }).fill(f.marker + '-BANK');
    await dialog.locator('input[type=file]').setInputFiles(`${dir}/receipt.pdf`);
    await dialog.locator('.pc-file').filter({ hasText: 'receipt.pdf' }).waitFor();
    check((await first.innerText()).includes('300.00'), 'remaining balances loaded separately');
    check((await dialog.locator('.pc-batch-payment-total').innerText()).includes('400.00'), 'partial batch preview is 400 CNY');
    await shot('01-batch-payment-tablet');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('02-batch-payment-mobile');
    check(await dialog.getByRole('button', { name: '确认登记 2 笔付款' }).isVisible(), 'mobile batch confirmation visible');
    await page.setViewportSize({ width: 1366, height: 1024 });
    const posting = page.waitForResponse(response => response.url().endsWith('/api/purchases') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '确认登记 2 笔付款' }).click();
    const response = await posting, result = await response.json();
    check(response.ok() && result.data.totalCents === 40000 && result.data.count === 2, 'batch saved with actual total 400 CNY');
    await dialog.waitFor({ state: 'detached' }); await rows(1);
    await page.waitForFunction(() => document.querySelector('.pc-table-wrap tbody')?.textContent.includes('部分付款'));
    const bodies = await page.evaluate(async ids => Promise.all(ids.map(async id => (await (await fetch('/api/purchases?record=' + id)).json()).data)), f.fundIds);
    check(bodies[0].record.status === 'PAID' && bodies[1].record.status === 'PARTIAL', 'full and partial payment statuses are independent');
    check(bodies.every(body => body.attachments.some(file => file.originalName === 'receipt.pdf' && file.entityType === 'PAYMENT_BATCH')), 'same receipt visible on both funds');
    check(bodies.every(body => body.record.payments[0].batch.number === result.data.number), 'each payment retains readable batch number');
    const retry = await page.evaluate(async ({ body, key }) => {
      const response = await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body });
      return { status: response.status, data: await response.json() };
    }, { body: response.request().postData(), key: response.request().headers()['idempotency-key'] });
    check(retry.status === 200 && retry.data.data.id === result.data.id, 'network retry returns original batch');
    await page.getByRole('combobox').filter({ has: page.locator('option[value=history]') }).selectOption('history');
    await rows();
    await page.getByLabel('选择当前页全部记录').check();
    check((await page.locator('.pc-selection').innerText()).includes('剩余待付 ¥100.00'), 'selection total shows remaining 100 CNY');
    await page.getByRole('button', { name: '批量登记打款（2 笔）', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '批量登记打款', exact: true });
    const invalid = dialog.locator('.pc-batch-payment-row').filter({ hasText: '不可登记' });
    await invalid.waitFor(); check(await invalid.count() === 1, 'already paid row shows exclusion reason');
    await invalid.getByRole('button', { name: '移除本笔' }).click();
    await dialog.getByLabel('统一公司付款账户', { exact: true }).fill('验收公司账户');
    await dialog.getByLabel('统一银行流水号（同一笔转账时填写）', { exact: true }).fill(f.marker + '-BALANCE');
    await dialog.getByRole('button', { name: '确认登记 1 笔付款' }).click();
    await dialog.waitFor({ state: 'detached' }); await rows();
    await page.getByLabel('选择当前页全部记录').check();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出选中', exact: true }).click();
    await (await downloading).saveAs(`${dir}/finance.xlsx`);
    checks.push('remaining payment and finance export completed through UI');

    await page.goto(origin + '/workspace/knowledge');
    await page.getByRole('button', { name: '新增知识', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('知识标题 *', { exact: true }).fill('Office 附件验收 ' + f.marker);
    let interrupted = false;
    await page.route('**/api/knowledge/attachments/upload', async route => {
      if (route.request().method() === 'POST' && !interrupted) { interrupted = true; await route.abort('failed'); }
      else await route.continue();
    });
    await dialog.getByLabel('选择知识附件').setInputFiles(['xls', 'xlsx', 'doc', 'docx'].map(ext => `${dir}/${f.marker}-资料.${ext}`));
    await dialog.getByRole('button', { name: '重试', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.hm-knowledge-upload-queue')?.textContent.includes('上传中'));
    check(await dialog.getByRole('button', { name: '保存知识', exact: true }).isDisabled(), 'failed upload prevents publishing incomplete knowledge');
    check(await dialog.getByLabel('知识标题 *', { exact: true }).inputValue() === 'Office 附件验收 ' + f.marker, 'upload failure preserves typed title');
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.hm-knowledge-upload-row')].length === 4 && [...document.querySelectorAll('.hm-knowledge-upload-row')].every(row => row.textContent.includes('已上传，待保存')));
    await page.unroute('**/api/knowledge/attachments/upload');
    await shot('03-office-upload-tablet');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('04-office-upload-mobile');
    check(await dialog.getByRole('button', { name: '保存知识', exact: true }).isVisible(), 'mobile knowledge save button visible');
    await page.setViewportSize({ width: 1366, height: 1024 });
    const saving = page.waitForResponse(response => response.url().endsWith('/api/knowledge/articles') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存知识', exact: true }).click();
    const saved = await (await saving).json();
    check(saved.ok && saved.article.content === '' && saved.article.attachments.length === 4, 'file-only knowledge saves all four Office formats');
    await dialog.waitFor({ state: 'detached' });
    await page.locator('.hm-knowledge-attachments a[download], .hm-knowledge-attachments a[aria-label^="下载 "]').first().waitFor();
    for (const ext of ['xls', 'xlsx', 'doc', 'docx']) {
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: `下载 ${f.marker}-资料.${ext}`, exact: true }).click();
      await (await download).saveAs(`${dir}/download.${ext}`);
    }
    checks.push('four Office downloads completed through authenticated UI');
    await page.getByRole('textbox', { name: '搜索知识库' }).fill(f.marker + '-资料.xls');
    await page.waitForFunction(title => document.querySelector('.hm-knowledge-results')?.textContent.includes(title) || [...document.querySelectorAll('button')].some(button => button.textContent.includes(title)), 'Office 附件验收 ' + f.marker);
    const search = await page.evaluate(async marker => (await (await fetch('/api/knowledge/search?source=article&category=all&keyword=' + encodeURIComponent(marker + '-资料.xls'))).json()), f.marker);
    check(search.ok && search.results.some(row => row.sourceId === saved.article.id), 'filename search retrieves file-only knowledge');
    await shot('05-office-knowledge-saved');
    check(errors.length === 0, 'no unexpected browser errors: ' + JSON.stringify(errors));
    return { passed: true, checks, articleId: saved.article.id, paymentBatch: result.data.number };
  } catch (error) { await shot('failure').catch(() => {}); throw error; }
}
try {
  writeFileSync(generated, `async page => { const scenario=${scenario.toString()}; return scenario(page,${JSON.stringify(origin)},${JSON.stringify(f)},${JSON.stringify(dir)}); }`);
  cli(['open', origin + '/login']);
  writeFileSync(join(dir, 'initial-snapshot.txt'), cli(['snapshot']));
  const output = cli(['run-code', '--filename', generated]);
  writeFileSync(join(dir, 'browser-runtime.txt'), output);
  assert.match(output, /"passed":\s*true/);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const downloads = {};
  for (const ext of ['xls', 'xlsx', 'doc', 'docx']) {
    const downloaded = readFileSync(join(dir, `download.${ext}`));
    assert.equal(hash(downloaded), hash(readFileSync(join(fixtureDir, `knowledge.${ext}`))));
    downloads[ext] = { bytes: downloaded.length, sha256: hash(downloaded) };
  }
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(join(dir, 'finance.xlsx'));
  const summary = book.getWorksheet('付款汇总'), detail = book.getWorksheet('采购明细');
  assert.equal(summary.rowCount, 3); assert.equal(detail.rowCount, 6);
  assert.equal(Number(summary.getCell('G2').value) + Number(summary.getCell('G3').value), 500);
  assert.equal(Number(summary.getCell('H2').value) + Number(summary.getCell('H3').value), 0);
  assert.ok([2, 3, 4, 5, 6].every(i => detail.getCell(`E${i}`).value && detail.getCell(`G${i}`).value === 2));
  writeFileSync(join(dir, 'browser-result.json'), JSON.stringify({ passed: true, downloads, finance: { fundRows: 2, itemRows: 5, paid: 500, remaining: 0 }, productionModified: false }, null, 2));
  console.log(output); console.log('Office download hashes and financial workbook verified.');
} finally { rmSync(generated, { force: true }); try { cli(['close']); } catch {} }
