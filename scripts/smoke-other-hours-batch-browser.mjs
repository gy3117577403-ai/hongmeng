import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
assert.equal(process.env.OTHER_HOURS_QA_ALLOW, 'disposable-other-hours-batch');
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const fixture = JSON.parse(readFileSync(process.env.OTHER_HOURS_QA_FIXTURE || '.local/other-hours-batch-fixture.json', 'utf8'));
const dir = resolve(process.env.OTHER_HOURS_QA_OUTPUT || 'output/playwright/other-hours-batch-local').replaceAll('\\', '/');
mkdirSync(dir, { recursive: true });
const generated = join(dir, 'browser-code.generated.cjs');
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=other-hours-batch', ...args], { encoding: 'utf8', timeout: 480000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}
async function scenario(page, origin, f, dir) {
  const checks = [], errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (request.url().includes('/api/other-work-times')) requests.push(request.url()); });
  const check = (yes, label) => { if (!yes) throw Error(label); checks.push(label); };
  const queryString = params => Object.entries(params).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
  const queryValue = (url, key) => { const part = (url.split('?')[1] || '').split('&').find(value => value.startsWith(key + '=')); return part ? decodeURIComponent(part.slice(key.length + 1).replace(/\+/g, ' ')) : null; };
  const request = (path, method = 'GET', body, extraHeaders = {}) => page.evaluate(async ({ path, method, body, extraHeaders }) => {
    const start = performance.now();
    const response = await fetch(path, { method, cache: 'no-store', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const bytes = await response.arrayBuffer(), text = new TextDecoder().decode(bytes);
    let value; try { value = JSON.parse(text); } catch { value = null; }
    return { status: response.status, body: value, bytes: bytes.byteLength, milliseconds: performance.now() - start, etag: response.headers.get('etag'), contentType: response.headers.get('content-type'), serverTiming: response.headers.get('server-timing') };
  }, { path, method, body, extraHeaders });
  const shot = name => page.screenshot({ path: `${dir}/${name}.png`, fullPage: false, animations: 'disabled' });
  const stable = async (expectedPage = 1) => { await page.waitForFunction(expected => { const list = document.querySelector('.oh-list'); return list?.getAttribute('aria-busy') === 'false' && list.dataset.page === String(expected) && !!list.querySelector('.oh-row'); }, expectedPage); };
  const search = async value => {
    const response = page.waitForResponse(r => r.url().includes('/api/other-work-times?') && r.url().includes('part=rows') && queryValue(r.url(), 'search') === value);
    await page.getByRole('searchbox', { name: '搜索申报' }).fill(value); await response; await stable();
  };
  const report = async () => (await request('/api/reports/employee-attainment?' + queryString({ period: 'today', date: f.today, employeeId: f.accounts[0].employeeId }))).body.report;
  const login = async (account, path) => {
    await page.context().clearCookies(); await page.goto(origin + '/login?next=' + encodeURIComponent(path));
    await page.getByLabel('员工编号 / 管理账号').fill(account.username); await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.waitForURL(url => url.pathname === path, { timeout: 60000 });
  };
  try {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await login(f.accounts[2], '/workspace/other-hours/approvals'); await stable(); await search(f.search);
    await page.getByRole('button', { name: '批量审批', exact: true }).waitFor();
    check(!requests.some(url => url.includes('employees=1')), 'initial approval view does not load the employee picker');
    check(!requests.some(url => url.includes('expanded=1')), 'collapsed reconciliation does not query production time details');
    const summaryBeforePaging = requests.filter(url => url.includes('part=summary')).length;
    await page.getByRole('button', { name: '批量审批', exact: true }).click();
    await page.getByRole('checkbox', { name: '全选本页', exact: true }).check();
    const pageCount = await page.locator('.oh-row-checkbox:checked').count();
    check(pageCount === 29, 'first page excludes the self-review request');
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await stable(2);
    await page.getByRole('checkbox', { name: '全选本页', exact: true }).check();
    check((await page.locator('.oh-batch-footer').innerText()).includes('已选 59 笔'), 'selection persists across pages');
    check(requests.filter(url => url.includes('part=summary')).length === summaryBeforePaging, 'pagination reuses the scoped summary');
    await page.getByRole('button', { name: '选择当前筛选全部', exact: true }).click();
    await page.getByText('已选 156 笔', { exact: true }).waitFor();
    check((await page.locator('.oh-batch-select').innerText()).includes('排除 1 笔'), 'all-filter selection includes 156 eligible rows and excludes self');
    await shot('01-cross-page-selection');
    await search(f.search + ' 010');
    await page.getByText('已选 0 笔', { exact: true }).waitFor();
    check((await page.locator('.oh-batch-select').innerText()).includes('已清除原选择'), 'changing filters clears previous selection explicitly');
    await search(f.search);

    const query = '/api/other-work-times?' + queryString({ scope: 'manage', status: 'PENDING', search: f.search, from: f.today, to: f.today });
    const measurements = { legacy: [], compact: [], fullDetail: [], baseDetail: [] };
    for (let i = 0; i < 8; i++) {
      for (const [key, url] of [['legacy', query], ['compact', query + '&part=rows'], ['fullDetail', '/api/other-work-times/' + f.rows[10].id], ['baseDetail', '/api/other-work-times/' + f.rows[10].id + '?part=base']]) {
        const result = await request(url); check(result.status === 200, `measurement ${key} ${i + 1} succeeds`);
        measurements[key].push({ milliseconds: result.milliseconds, bytes: result.bytes, serverTiming: result.serverTiming });
      }
    }
    check(measurements.compact[0].bytes < measurements.legacy[0].bytes * 0.5, 'compact list removes more than half the legacy payload with identical 30-row pagination');
    const photo = '/api/other-work-times/' + f.rows[10].id + '/attachments/' + f.rows[10].attachmentId;
    const firstPhoto = await request(photo), reusedPhoto = await request(photo, 'GET', undefined, { 'If-None-Match': firstPhoto.etag });
    check(firstPhoto.status === 200 && reusedPhoto.status === 304, 'attachment revalidation reuses bytes after a fresh authorization check');
    const previewPhoto = await request(photo + '?preview=1');
    check(previewPhoto.status === 200 && previewPhoto.contentType === 'image/webp' && previewPhoto.bytes < firstPhoto.bytes, 'detail thumbnail is smaller than the intact original');

    let releaseContext;
    const delayed = new Promise(resolve => { releaseContext = resolve; });
    await page.route('**/api/other-work-times/*?part=context', async route => { await delayed; await route.continue(); });
    await page.locator('.oh-row').nth(2).click();
    await page.locator('.oh-detail .oh-description').waitFor();
    check((await page.locator('.oh-detail').innerText()).includes('正在加载考勤与损耗摘要'), 'base detail stays usable while reconciliation is waiting');
    const resumedContext = page.waitForResponse(r => r.url().includes('?part=context') && r.ok());
    releaseContext(); await resumedContext; await page.unroute('**/api/other-work-times/*?part=context');
    await page.getByText('展开审批核对', { exact: true }).waitFor();
    const expandedContext = page.waitForResponse(r => r.url().includes('expanded=1') && r.ok());
    await page.getByText('展开审批核对', { exact: true }).click(); await expandedContext;
    check(requests.some(url => url.includes('expanded=1')), 'detailed reconciliation is fetched when expanded');

    const before = await report();
    await page.getByRole('button', { name: '选择当前筛选全部', exact: true }).click(); await page.getByText('已选 156 笔', { exact: true }).waitFor();
    // A record changes after selection. The batch must skip it rather than
    // silently refreshing its version or applying a second approval.
    check((await request('/api/other-work-times/' + f.rows[0].id, 'PATCH', { action: 'APPROVE', version: 0 })).status === 200, 'concurrent single approval succeeds');
    let dropped = false;
    await page.route('**/api/other-work-times/batch-approve', async route => {
      if (!dropped) { dropped = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
    });
    await page.getByRole('button', { name: '一键同意', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认批量同意' }); await dialog.waitFor();
    check((await dialog.innerText()).includes('156 笔') && (await dialog.innerText()).includes('13 小时'), 'one confirmation shows exact count and full requested duration');
    await dialog.getByText('核对所选明细', { exact: true }).click();
    check(await dialog.locator('.oh-batch-review-list p').count() === 156, 'confirmation contains the fixed 156-record snapshot');
    await shot('02-confirmation');
    await dialog.getByRole('button', { name: '确认同意 156 笔', exact: true }).click();
    await page.locator('.oh-batch-results').waitFor(); await stable();
    check((await page.locator('.oh-batch-footer').innerText()).includes('已选 156 笔'), 'lost response preserves selection for a safe retry');
    await page.unroute('**/api/other-work-times/batch-approve');
    await page.getByRole('button', { name: '一键同意', exact: true }).click();
    await page.getByRole('button', { name: '确认同意 156 笔', exact: true }).click();
    await page.getByText('通过 155 笔 · 跳过 1 笔 · 失败 0 笔', { exact: true }).waitFor({ timeout: 120000 });
    await stable();
    check((await page.locator('.oh-batch-footer').innerText()).includes('已选 1 笔'), 'partial conflict retains only the unsuccessful record');
    const after = await report();
    check(after.summary.otherWorkMilliseconds === before.summary.otherWorkMilliseconds && after.summary.attainmentBasisPoints === before.summary.attainmentBasisPoints, 'employee hours and attainment remain unchanged after 156 full approvals');
    for (const id of [f.rows[155].id, f.rows[10].id, f.rows[0].id]) {
      const detail = (await request('/api/other-work-times/' + id + '?part=base')).body.row;
      check(detail.status === 'APPROVED' && detail.reviews.filter(row => row.action === 'APPROVE').length === 1, 'one persisted approval per sampled row after retry: ' + id);
    }
    check((await request('/api/other-work-times/' + f.own.id + '?part=base')).body.row.status === 'PENDING', 'self-review request remains pending');
    await shot('03-batch-result');
    await page.getByRole('button', { name: /^已处理/ }).click(); await stable();
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出', exact: true }).click();
    await (await downloadPromise).saveAs(`${dir}/approved-ledger.xlsx`);
    check(await page.getByRole('button', { name: '批量审批', exact: true }).count() === 0, 'processed records do not expose batch approval');
    await page.reload(); await stable();
    const persisted = (await request(query.replace('status=PENDING', 'status=APPROVED') + '&part=rows')).body;
    check(persisted.pagination.total === 156, 'all 156 approvals persist after page reload');

    await page.setViewportSize({ width: 390, height: 844 });
    await login(f.accounts[0], '/field-report/other-hours');
    await page.getByRole('button', { name: '我的申报', exact: true }).click(); await stable();
    await page.locator('.oh-row').first().click();
    await page.getByRole('dialog', { name: '申报详情' }).waitFor();
    await page.getByRole('dialog').getByText('处理轨迹', { exact: false }).waitFor();
    check(await page.getByRole('button', { name: '一键同意', exact: true }).count() === 0, 'employee mobile detail preserves read-only approved records');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390px employee view has no horizontal overflow');
    await shot('04-mobile-detail');
    await page.context().clearCookies();
    check((await request(photo, 'GET', undefined, { 'If-None-Match': firstPhoto.etag })).status === 401, 'cached attachment never bypasses login');
    check((await request('/api/other-work-times/batch-approve', 'POST', { batchId: f.rows[0].id, items: [{ id: f.rows[0].id, version: 0 }] })).status === 401, 'batch approval requires login');
    check(errors.length === 0, 'no browser runtime exceptions');
    return { passed: true, checks, measurements, before: before.summary, after: after.summary };
  } catch (error) { await shot('failure').catch(() => {}); throw error; }
}
try {
  writeFileSync(generated, `async page => { const scenario=${scenario.toString()}; return scenario(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)}); }`);
  cli(['open', origin + '/login']);
  const output = cli(['run-code', '--filename', generated]); writeFileSync(join(dir, 'browser-runtime.txt'), output);
  assert.match(output, /"passed":\s*true/);
  const match = output.match(/### Result\s*([\s\S]*?)(?=\n### |$)/);
  const result = match ? JSON.parse(match[1].trim()) : { passed: true, checks: output };
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(join(dir, 'approved-ledger.xlsx'));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 159);
  const exportedIds = sheet.getColumn(16).values.slice(4);
  assert.equal(new Set(exportedIds).size, 156);
  assert.deepEqual([...exportedIds].sort(), fixture.rows.map(row => row.id).sort());
  assert.ok(Math.abs(sheet.getColumn(7).values.slice(4).reduce((sum, value) => sum + Number(value), 0) - 13) < 0.000001);
  assert.equal(workbook.worksheets[1].getColumn(4).values.filter(value => value === 'APPROVE').length, 156);
  writeFileSync(join(dir, 'acceptance.json'), JSON.stringify({ ...result, exportedRecords: 156 }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: Array.isArray(result.checks) ? result.checks.length : undefined, exportedRecords: 156, measurements: result.measurements }, null, 2));
} finally { rmSync(generated, { force: true }); try { cli(['close']); } catch {} }
