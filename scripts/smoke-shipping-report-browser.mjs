import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
if (process.env.SHIPPING_QA_ALLOW !== 'disposable-shipping-reports') throw Error('Disposable shipping guard required');
const origin = process.env.SHIPPING_QA_BASE || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Loopback runtime required');
const fixture = JSON.parse(readFileSync(process.env.SHIPPING_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
if (!fixture.marker?.startsWith('FGQ-')) throw Error('Unexpected fixture');
const dir = process.env.SHIPPING_QA_OUTPUT || 'output/playwright/shipping-report';
mkdirSync(dir, { recursive: true });
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=shipping-reports-qa', ...args], { encoding: 'utf8', timeout: 240000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status || /### Error/.test(output)) throw Error(result.error?.message || output);
  return output;
}
async function scenario(page, f, base, out) {
  const checks = [], errors = [], reports = [], geometry = [];
  page.on('pageerror', error => errors.push(String(error)));
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const api = (path, method = 'GET', body, key) => page.evaluate(async ({ path, method, body, key }) => {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.headers.get('content-type')?.includes('application/pdf')) return { status: r.status, type: 'pdf', length: (await r.arrayBuffer()).byteLength };
    return { status: r.status, body: await r.json() };
  }, { path, method, body, key });
  const login = async user => {
    await page.context().clearCookies();
    await page.goto(base + '/login?next=' + encodeURIComponent('/workspace/finished-goods?q=' + f.marker));
    await page.getByLabel('员工编号 / 管理账号').fill(user.username);
    await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/workspace/finished-goods', { timeout: 30000 });
    await page.locator('.fg-table').waitFor();
  };
  const reportDialog = () => page.getByRole('dialog', { name: '出货报告', exact: true });
  const row = index => page.locator('tr[data-fg-row]').filter({ has: page.locator('.fg-identity[title=' + JSON.stringify(f.lots[index].workOrderCode) + ']') }).first();
  const preview = async () => {
    await page.locator('.sr-preview-updating').waitFor({ state: 'detached', timeout: 45000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.sr-paper-stage canvas');
      if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0, white = 0;
      for (let i = 0; i < pixels.length; i += 80) { if (pixels[i + 3] && pixels[i] < 170) dark++; if (pixels[i] > 240 && pixels[i + 1] > 240) white++; }
      return dark > 20 && white > 100;
    }, null, { timeout: 40000 });
    check(await page.locator('.sr-error').count() === 0, 'PDF preview has no render/load error');
  };
  const screenshot = name => page.screenshot({ path: out + '/' + name + '.png', fullPage: false });
  try {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto(base + '/login');
    check((await api('/api/finished-goods/reports?lotId=' + f.lots[0].id)).status === 401, 'anonymous context is denied');
    await login(f.actor);
    const pending = (await api('/api/finished-goods/reports?lotId=' + f.lots[3].id)).body.data;
    check(pending.eligible === false, 'unreceived product cannot create report');
    const invalidPending = await api('/api/finished-goods/reports/preview', 'POST', { lotId: f.lots[3].id, template: 'general', quantity: 1, version: pending.version });
    check(invalidPending.status === 409, 'unreceived preview blocked by server');
    for (const index of [0, 1, 2, 4]) {
      const c = (await api('/api/finished-goods/reports?lotId=' + f.lots[index].id)).body.data;
      const r = await api('/api/finished-goods', 'POST', { action: 'RECEIVE', lotId: f.lots[index].id, version: c.version, quantity: 20, checked: true }, f.marker + '-receipt-' + index);
      check(r.status === 200, 'product ' + index + ' receives actual stock through business API');
    }
    await page.reload(); await row(0).getByRole('button', { name: '出货报告', exact: true }).waitFor();
    const sourceUrl = page.url(), sourceScroll = await page.locator('.fg-table-scroll').evaluate(el => el.scrollTop);
    const before = (await api('/api/finished-goods?view=stock&scope=all&q=' + f.marker)).body.data;
    await row(0).getByRole('button', { name: '出货报告', exact: true }).click(); await reportDialog().waitFor();
    await preview();
    check(await reportDialog().getByRole('button', { name: '益威', exact: true }).getAttribute('aria-pressed') === 'true', 'Yiwei customer selects Yiwei template');
    check(await page.getByLabel('报告客户').inputValue() === f.lots[0].customerName, 'customer auto-filled accurately');
    check(await page.getByLabel('报告规格').inputValue() === f.lots[0].specification, 'specification maps to part number');
    check(await page.getByLabel('报告订单号').inputValue() === f.lots[0].orderNo, 'order auto-filled');
    check(await page.getByLabel('报告客户').getAttribute('readonly') !== null, 'source customer cannot be silently overwritten');
    check((await page.getByLabel('报告原图').inputValue()).includes(f.lots[0].drawingId), 'only explicitly linked original is automatically attached');
    await screenshot('01-yiwei-1366x1024');
    for (const size of [{ width: 1366, height: 768 }, { width: 1366, height: 1024 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size); await preview();
      const g = await page.evaluate(() => { const d = document.querySelector('.sr-dialog').getBoundingClientRect(), s = document.querySelector('.sr-sidebar-scroll'), footer = document.querySelector('.sr-footer').getBoundingClientRect(); return { w: innerWidth, h: innerHeight, left: d.left, right: d.right, top: d.top, bottom: d.bottom, footerBottom: footer.bottom, innerScroll: s.scrollHeight > s.clientHeight, documentScroll: document.documentElement.scrollHeight > innerHeight + 2, horizontal: document.documentElement.scrollWidth > innerWidth + 2 }; });
      check(g.top >= 0 && g.bottom <= size.height && g.right <= size.width && g.footerBottom <= size.height && !g.documentScroll && !g.horizontal, 'modal and footer fit ' + size.width + 'x' + size.height);
      geometry.push(g);
      await screenshot('layout-' + size.width + 'x' + size.height);
    }
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.getByLabel('原图页码').fill('2'); await preview(); await screenshot('02-rotated-pdf-page2');
    await page.getByLabel('原图页码').fill('1'); await page.getByLabel('报告数量').fill('12');
    await page.getByLabel('内部批号').fill('260927-01'); await preview();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载报告 PDF' }).click();
    const download = await downloadPromise; await download.saveAs(out + '/yiwei.pdf'); await preview();
    const reportList = (await api('/api/finished-goods/reports?lotId=' + f.lots[0].id)).body.data.reports;
    check(reportList.length === 1 && reportList[0].quantity === 12, 'download saves one immutable report with entered quantity');
    reports.push(reportList[0]);
    await screenshot('03-saved-report');
    await page.getByRole('button', { name: '关闭出货报告' }).click(); await page.locator('.sr-dialog').waitFor({ state: 'detached' });
    check(page.url() === sourceUrl, 'close returns to originating warehouse filters');
    check((await page.locator('.fg-table-scroll').evaluate(el => el.scrollTop)) === sourceScroll, 'close preserves table position');
    const after = (await api('/api/finished-goods?view=stock&scope=all&q=' + f.marker)).body.data;
    check(JSON.stringify(before.rows.map(r => [r.lotId, r.pending, r.available, r.shippedQuantity, r.version])) === JSON.stringify(after.rows.map(r => [r.lotId, r.pending, r.available, r.shippedQuantity, r.version])), 'report generation does not alter stock, shipment or source version');
    await row(0).getByRole('button', { name: '出货报告', exact: true }).click(); await preview();
    await page.getByRole('tab', { name: /历史报告/ }).click(); await page.locator('.sr-history-row').first().click(); await preview();
    const archived = await page.request.get(base + '/api/finished-goods/reports/' + reports[0].id + '/file'); check(archived.status() === 200, 'historical PDF available');
    const repeated = page.waitForEvent('download'); await page.getByRole('button', { name: '下载报告 PDF' }).click(); await (await repeated).saveAs(out + '/yiwei-history.pdf');
    check((await api('/api/finished-goods/reports?lotId=' + f.lots[0].id)).body.data.reports.length === 1, 'reprint/download does not create another report');
    await page.getByRole('button', { name: '打印报告', exact: true }).click();
    await page.locator('iframe.sr-print-frame').waitFor({ state: 'attached' });
    check((await page.locator('iframe.sr-print-frame').getAttribute('src')).includes(reports[0].id), 'print uses archived PDF bytes');
    await page.getByRole('button', { name: '关闭出货报告' }).click();
    for (const [index, template, name] of [[1, '欣兴汇', 'xinxinghui'], [2, '常规', 'general']]) {
      await row(index).getByRole('button', { name: '出货报告', exact: true }).click(); await preview();
      check(await reportDialog().getByRole('button', { name: template, exact: true }).getAttribute('aria-pressed') === 'true', name + ' template selected correctly');
      if (index === 1) { check(await page.getByText('抬头 · 杭州迈斯嘉电子科技有限公司').count() === 1, 'Xinxinghui issuer preserved'); check(await page.getByLabel('报告原图').count() === 0, 'no sketch control for template without sketch'); }
      else check(await page.getByLabel('报告原图').inputValue() === '', 'missing original skips attachment');
      await screenshot('04-' + name);
      const nextDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下载报告 PDF' }).click(); await (await nextDownload).saveAs(out + '/' + name + '.pdf');
      await preview(); reports.push((await api('/api/finished-goods/reports?lotId=' + f.lots[index].id)).body.data.reports[0]);
      await page.getByRole('button', { name: '关闭出货报告' }).click();
    }
    await row(0).getByRole('button', { name: '出货报告', exact: true }).click(); await preview();
    await reportDialog().getByRole('button', { name: '常规', exact: true }).click(); await preview();
    check(await page.getByLabel('报告客户').inputValue() === f.lots[0].customerName, 'manual template override keeps original Yiwei customer');
    await page.getByRole('button', { name: '关闭出货报告' }).click();
    check(await page.getByText('有尚未保存的填写', { exact: true }).count() === 1, 'unsaved values receive in-modal confirmation');
    await page.getByRole('button', { name: '继续填写', exact: true }).click(); check(await page.getByLabel('报告客户').inputValue() === f.lots[0].customerName, 'continue keeps draft');
    await page.getByRole('button', { name: '关闭出货报告' }).click(); await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();
    await row(0).getByRole('button', { name: '出货报告', exact: true }).click(); await preview();
    await page.getByLabel('报告数量').fill('21'); await page.getByRole('alert').waitFor();
    check(await page.getByRole('button', { name: '保存报告', exact: true }).isDisabled(), 'oversized quantity cannot save');
    await page.getByRole('button', { name: '关闭出货报告' }).click(); await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();
    await login(f.user);
    const c = (await api('/api/finished-goods/reports?lotId=' + f.lots[0].id)).body.data;
    const input = { ...c.source, version: c.version, template: 'yiwei', quantity: 12, reportDate: '2026-09-27', drawingId: '' };
    check((await api('/api/finished-goods/reports/preview', 'POST', input)).type === 'pdf', 'read-only account may preview');
    check((await api('/api/finished-goods/reports', 'POST', input, f.marker + '-reader-write')).status === 403, 'read-only account cannot save a report');
    check((await api('/api/finished-goods/reports/' + reports[0].id + '/file')).type === 'pdf', 'read-only account may download saved report');
    await row(0).getByRole('button', { name: '出货报告', exact: true }).click(); await preview();
    check(await page.getByRole('button', { name: '保存报告', exact: true }).count() === 0, 'read-only UI has no save action');
    await screenshot('05-read-only-report');
    await page.context().clearCookies();
    check((await api('/api/finished-goods/reports/' + reports[0].id + '/file')).status === 401, 'anonymous saved PDF is denied');
    check(errors.length === 0, 'browser has no uncaught exceptions');
    return { passed: true, checks, geometry, reports: reports.map(r => ({ id: r.id, number: r.number, customer: r.snapshot.customerName, template: r.template })), errors };
  } catch (error) { await screenshot('failure'); throw Error(String(error) + ' | page errors: ' + errors.join(';')); }
}
const codeFile = join(dir, 'browser.generated.cjs');
try {
  writeFileSync(codeFile, 'async page => { return await (' + scenario.toString() + ')(page,' + JSON.stringify(fixture) + ',' + JSON.stringify(origin) + ',' + JSON.stringify(dir) + '); }');
  cli(['open', origin + '/login']); writeFileSync(join(dir, 'initial-snapshot.txt'), cli(['snapshot']));
  const output = cli(['run-code', '--filename=' + codeFile]);
  writeFileSync(join(dir, 'browser-runtime.txt'), output);
  if (!output.includes('"passed": true') && !output.includes('"passed":true')) throw Error('Missing browser acceptance result');
  const pdfs = [];
  for (const name of ['general', 'yiwei', 'xinxinghui']) {
    const body = readFileSync(join(dir, name + '.pdf')), doc = await PDFDocument.load(body);
    if (doc.getPageCount() !== 1) throw Error('Incorrect page count: ' + name);
    pdfs.push({ template: name, bytes: body.length, pages: doc.getPageCount(), subject: doc.getSubject(), author: doc.getAuthor(), title: doc.getTitle() });
  }
  if (!readFileSync(join(dir, 'yiwei.pdf')).equals(readFileSync(join(dir, 'yiwei-history.pdf')))) throw Error('Historical download is not byte-for-byte identical');
  writeFileSync(join(dir, 'pdf-evidence.json'), JSON.stringify({ passed: true, pdfs, historyBytesIdentical: true }, null, 2));
  console.log('Shipping report browser, PDF, access and immutable-history acceptance passed.');
} catch (error) { writeFileSync(join(dir, 'browser-failure.txt'), String(error)); throw error; }
finally { rmSync(codeFile, { force: true }); try { cli(['close']); } catch { /* Preserve original failure. */ } }
