import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.OFFICE_QA_ALLOW, 'disposable-office-runtime');
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3275';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const dir = resolve(process.env.OFFICE_QA_OUTPUT || 'output/playwright/knowledge-preview-local').replaceAll('\\', '/');
const fixture = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'));
assert.ok(fixture.marker.startsWith('OPQ-')); mkdirSync(dir, { recursive: true });
const generated = join(dir, 'browser-code.generated.cjs');
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=knowledge-preview', ...args], { encoding: 'utf8', timeout: 540000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status) { writeFileSync(join(dir, 'browser-runtime.txt'), output); throw Error(result.error?.message || output); }
  return output;
}
async function scenario(page, origin, f, dir) {
  const checks = [], errors = [], pdfs = {};
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon.ico')) errors.push(message.text()); });
  const shot = name => page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
  const choose = async type => {
    const file = f.files.find(file => file.type === type);
    await page.locator('.hm-knowledge-file-strip').getByRole('button', { name: file.name, exact: true }).click();
    await page.locator('.hm-knowledge-detail-scroll').evaluate(node => { node.scrollTop = 0; });
    return file;
  };
  const waitPdf = async () => page.waitForFunction(() => [...document.querySelectorAll('.pdf-viewer canvas')].some(canvas => canvas.width > 100 && canvas.height > 100 && canvas.style.visibility !== 'hidden') && !document.querySelector('.pdf-viewer .viewer-state, .pdf-viewer .render-badge'), null, { timeout: 90000 });
  const enterMobilePreview = async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Wait for the responsive React effect; offscreen panels can briefly still be "visible".
    await page.waitForFunction(() => {
      const detail = document.querySelector('.hm-knowledge-detail');
      return window.matchMedia('(max-width: 1100px)').matches && detail && (detail.classList.contains('open') || detail.getAttribute('aria-hidden') === 'true');
    });
    if (await page.locator('.hm-knowledge-detail').getAttribute('aria-hidden') === 'true') await page.locator('.hm-knowledge-results button.active').click();
    await page.locator('.hm-knowledge-detail.open:not([aria-hidden="true"])').waitFor();
    const fullscreen = page.getByRole('dialog', { name: /^Office 预览/ });
    if (!await fullscreen.isVisible()) await page.getByRole('region', { name: /^Office 预览/ }).getByRole('button', { name: '全屏预览', exact: true }).click();
    await fullscreen.waitFor();
  };
  try {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto(origin + '/login?next=' + encodeURIComponent('/workspace/knowledge?articleId=' + f.articleId));
    await page.getByLabel('员工编号 / 管理账号').fill(f.user.username);
    await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/workspace/knowledge');
    await page.locator('.hm-knowledge-file-strip').waitFor();
    await choose('xlsx');
    const grid = page.getByRole('region', { name: /^Office 预览/ });
    await grid.getByText('000123', { exact: true }).waitFor({ timeout: 90000 });
    check(await grid.getByText('12345678901234567890', { exact: true }).isVisible(), 'leading zero and long material code preserved');
    check(await grid.getByText('2026-10-21', { exact: true }).isVisible(), 'formatted date preserved');
    check(await grid.getByRole('navigation', { name: '工作表', exact: true }).getByRole('button').count() === 3, 'three visible sheets and no hidden worksheet');
    await shot('01-excel-tablet');
    await grid.getByRole('button', { name: '全屏预览', exact: true }).click();
    const full = page.getByRole('dialog', { name: /^Office 预览/ });
    await full.getByRole('button', { name: '替代型号', exact: true }).click();
    await full.getByText('MOLEX-02', { exact: true }).waitFor();
    await full.getByRole('button', { name: '大表分页', exact: true }).click();
    await full.getByText('HVSL-0001', { exact: true }).waitFor();
    await full.getByLabel('搜索当前工作表').fill('HVSL-1205');
    await full.getByText('HVSL-1205', { exact: true }).waitFor();
    check(await full.getByText('1 行匹配 · 3 列', { exact: true }).isVisible(), 'search reaches the final row beyond the first page');
    await full.getByLabel('搜索当前工作表').fill('');
    await full.getByText('HVSL-0001', { exact: true }).waitFor();
    await full.getByRole('button', { name: '下一页', exact: true }).click();
    await full.getByText('HVSL-0150', { exact: true }).waitFor();
    check(await full.getByLabel('工作表页码').inputValue() === '2', 'large sheet pagination reaches second page');
    await full.getByLabel('表格缩放').selectOption('125');
    const content = full.getByLabel('工作表内容', { exact: true });
    await content.evaluate(node => { node.scrollTop = 150; node.scrollLeft = 80; });
    const before = await content.evaluate(node => node.scrollTop);
    await shot('02-excel-fullscreen-pagination');
    await full.getByRole('button', { name: '退出全屏预览' }).click();
    check(await grid.getByLabel('工作表页码').inputValue() === '2', 'exiting full screen preserves worksheet page');
    check(await grid.getByLabel('工作表内容', { exact: true }).evaluate(node => node.scrollTop) === before, 'exiting full screen preserves scroll position');
    await grid.getByRole('button', { name: '版式预览', exact: true }).click(); await waitPdf(); await shot('03-excel-layout-with-image');
    for (const type of ['xlsx', 'docx', 'xls', 'doc']) {
      const file = await choose(type);
      if (type.startsWith('xls')) await page.getByRole('button', { name: '版式预览', exact: true }).click();
      await waitPdf();
      const data = await page.evaluate(async id => {
        const status = await (await fetch(`/api/knowledge/attachments/${id}/preview`)).json();
        const response = await fetch(status.preview.pdfUrl); const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: status.preview, contentType: response.headers.get('content-type'), signature: new TextDecoder().decode(bytes.slice(0, 5)), bytes: bytes.length };
      }, file.id);
      check(data.signature === '%PDF-' && data.contentType === 'application/pdf', `${type} renders real converted PDF from historical attachment`);
      pdfs[type] = { bytes: data.bytes, tableStatus: data.status.tableStatus };
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: `下载 ${file.name}`, exact: true }).click();
      await (await download).saveAs(`${dir}/download.${type}`);
      if (type === 'docx') { await page.locator('.hm-knowledge-detail-scroll').evaluate(node => { node.scrollTop = 0; }); await shot('04-word-table-image-tablet'); }
    }
    await choose('docx'); await waitPdf();
    const pageInput = page.locator('.pdf-viewer').getByLabel('预览页码');
    await pageInput.fill('2'); await pageInput.press('Enter'); await waitPdf();
    check(await pageInput.inputValue() === '2', 'Word preview jumps to second page');
    await enterMobilePreview();
    await waitPdf();
    await shot('05-word-mobile');
    check(await page.getByRole('button', { name: '退出全屏预览' }).isVisible(), 'mobile full-screen return control visible');
    await page.getByRole('button', { name: '退出全屏预览' }).click();
    await page.setViewportSize({ width: 1366, height: 1024 });
    await choose('xlsx'); await page.getByText('000123', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增知识', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '沉淀一条可复用经验' });
    await dialog.getByLabel('知识标题 *', { exact: true }).fill(`${f.marker} 新上传预览`);
    await dialog.locator('input[type=file]').setInputFiles(f.files.filter(file => ['xlsx', 'docx'].includes(file.type)).map(file => file.path));
    await page.waitForFunction(() => [...document.querySelectorAll('.hm-knowledge-upload-row')].length === 2 && [...document.querySelectorAll('.hm-knowledge-upload-row')].every(row => row.textContent.includes('已上传，待保存')));
    await dialog.getByRole('button', { name: '保存知识', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.locator('.hm-knowledge-file-strip').getByRole('button', { name: f.files[0].name, exact: true }).click();
    await page.getByText('000123', { exact: true }).waitFor({ timeout: 90000 });
    check(true, 'new Office upload saves and becomes previewable in the same flow');
    await shot('06-new-upload-preview');
    await enterMobilePreview();
    await shot('07-excel-mobile');
    check(await page.getByRole('navigation', { name: '工作表', exact: true }).isVisible(), 'mobile worksheet tabs visible');
    await page.reload();
    await page.locator('.hm-knowledge-results button.active').waitFor();
    await page.waitForFunction(() => !!document.querySelector('.hm-knowledge-detail[aria-hidden="true"] [data-office-fullscreen]'));
    check(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'a cold mobile load does not lock scrolling for a hidden Office preview');
    await enterMobilePreview();
    await page.getByRole('button', { name: '退出全屏预览' }).click();
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
    check(true, 'closing mobile Office detail releases the modal scroll lock');
    check(errors.length === 0, 'no unexpected browser errors: ' + JSON.stringify(errors));
    return { passed: true, checks, pdfs, productionModified: false };
  } catch (error) { await shot('failure').catch(() => {}); throw error; }
}
try {
  writeFileSync(generated, `async page => { const scenario=${scenario.toString()}; return scenario(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)}); }`);
  cli(['open', origin + '/login']); writeFileSync(join(dir, 'initial-snapshot.txt'), cli(['snapshot']));
  const output = cli(['run-code', '--filename', generated]); writeFileSync(join(dir, 'browser-runtime.txt'), output);
  assert.match(output, /"passed":\s*true/);
  for (const file of fixture.files) assert.equal(createHash('sha256').update(readFileSync(join(dir, `download.${file.type}`))).digest('hex'), file.hash);
  writeFileSync(join(dir, 'acceptance.json'), JSON.stringify({ passed: true, originalHashesVerified: 4, tablet: '1366x1024', mobile: '390x844', productionModified: false }, null, 2));
  console.log(output); console.log('All four original downloads hash-verified.');
} finally { rmSync(generated, { force: true }); try { cli(['close']); } catch {} }
