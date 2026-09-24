import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

if (process.env.SAMPLE_LIBRARY_QA_ALLOW !== 'disposable-sample-library') throw Error('Disposable runtime required');
const origin = process.env.SAMPLE_LIBRARY_QA_BASE || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('Loopback only');
const fixture = JSON.parse(readFileSync(process.env.SAMPLE_LIBRARY_FIXTURE || '/tmp/sample-library-fixture.json', 'utf8'));
if (!fixture.marker?.startsWith('SL-')) throw Error('Unexpected fixture');
const dir = process.env.MANUAL_BROWSER_OUTPUT || 'output/playwright/assembly-manual';
mkdirSync(dir, { recursive: true });
const file = join(dir, 'browser.generated.cjs');
const ids = [];
let cookie = '';
async function request(path, options = {}) {
  const response = await fetch(origin + path, { ...options, headers: { Cookie: cookie, Origin: origin, ...options.headers }, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw Error(path + ' HTTP ' + response.status + ': ' + (body.error || 'unexpected response'));
  return { response, body };
}
function cli(args) {
  const result = spawnSync('npx', ['--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=assembly-manual', ...args], { encoding: 'utf8', timeout: 120000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n\`\`\`[\s\S]*?\`\`\`(?:\r?\n)?/g, '').replaceAll(fixture.adminPassword, '[disposable-password]');
  if (result.status || result.error) throw Error(output || result.error.message);
  return output;
}
try {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.adminUsername, password: fixture.adminPassword }) });
  cookie = login.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
  if (!cookie) throw Error('Missing disposable administrator session');
  const titles = [];
  for (let i = 1; i <= 2; i += 1) {
    const title = fixture.marker + ' Assembly freeze ' + i; titles.push(title);
    const { body } = await request('/api/connector-assembly-manuals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, revision: 'QA-R1', fileMode: 'PDF', manufacturer: 'QA', keywords: fixture.marker }) });
    const manual = body.manual; ids.push(manual.id);
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let p = 1; p <= 3; p += 1) {
      const page = pdf.addPage([595, 842]);
      page.drawText('Assembly manual ' + i + ' / Page ' + p, { x: 30, y: 800, size: 16, font });
      // The previous automatic TOC regex blocked the main thread on this valid PDF text.
      page.drawText('Safety ' + '.'.repeat(48) + ' continued 2', { x: 30, y: 750, size: 10, font });
      page.drawText('Assembly overview . . . 2', { x: 30, y: 715, size: 12, font });
      page.drawText('Inspection ... 3', { x: 30, y: 680, size: 12, font });
    }
    const form = new FormData(); form.append('files', new Blob([await pdf.save()], { type: 'application/pdf' }), 'manual-freeze-' + i + '.pdf');
    await request('/api/connector-assembly-manual-versions/' + manual.latestVersion.id + '/assets/upload', { method: 'POST', body: form });
  }
  cli(['open', origin + '/login']);
  writeFileSync(join(dir, 'initial-snapshot.txt'), cli(['snapshot']));
  const code = async (page) => {
    const { fixture: f, origin, dir, titles } = INPUT, checks = [], errors = [];
    const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
    page.on('pageerror', error => errors.push(String(error)));
    page.setDefaultTimeout(20000);
    try {
      await page.setViewportSize({ width: 1366, height: 1024 });
      await page.goto(origin + '/login?next=' + encodeURIComponent('/connector-assembly-manuals'));
      await page.getByLabel('员工编号 / 管理账号').fill(f.adminUsername);
      await page.getByLabel('密码', { exact: true }).fill(f.adminPassword);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/connector-assembly-manuals');
      await page.waitForFunction(() => Number(document.querySelector('.pdf-stage canvas')?.getAttribute('data-rendered-page')) > 0 && !document.querySelector('.pdf-stage .viewer-state'));
      check(true, 'automatic first PDF opens despite long non-terminal dot leaders');
      await page.locator('.manual-card').filter({ hasText: titles[0] }).click();
      const toolbar = page.getByLabel('图纸预览工具栏', { exact: true });
      await toolbar.getByRole('button', { name: '下一页', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('input[aria-label="预览页码"]')?.value === '2');
      check(true, 'page navigation responds after automatic TOC extraction');
      await page.getByRole('button', { name: '目录 / 版本', exact: true }).click();
      await page.getByRole('button', { name: '生成目录建议', exact: true }).click();
      const toc = page.locator('.toc-suggestion-dialog');
      await toc.waitFor(); check(await toc.getByText('Assembly overview', { exact: true }).isVisible(), 'valid TOC suggestions remain available');
      await toc.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '关闭说明书资料面板', exact: true }).last().click();
      await page.locator('.manual-card').filter({ hasText: titles[1] }).click();
      await page.waitForFunction(() => Number(document.querySelector('.pdf-stage canvas')?.getAttribute('data-rendered-page')) > 0 && !document.querySelector('.pdf-stage .viewer-state'));
      check(true, 'switching manuals remains responsive');
      await page.screenshot({ path: dir + '/manual-ready-1366.png', animations: 'disabled' });
      const search = page.getByRole('textbox', { name: '搜索说明书库', exact: true });
      await search.fill(titles[0]);
      await page.waitForFunction(title => document.querySelectorAll('.manual-card').length === 1 && document.querySelector('.manual-card')?.textContent.includes(title), titles[0]);
      check(true, 'search remains responsive after preview load');
      check(errors.length === 0, 'no uncaught errors');
      return { ok: true, checks };
    } catch (error) {
      await page.screenshot({ path: dir + '/failure.png', animations: 'disabled', timeout: 3000 }).catch(() => {});
      throw Error(error.message + '\nChecks: ' + JSON.stringify(checks) + '\nUI: ' + await page.locator('body').ariaSnapshot().catch(() => 'unavailable'));
    }
  };
  writeFileSync(file, code.toString().replace('INPUT', JSON.stringify({ fixture: { adminUsername: fixture.adminUsername, adminPassword: fixture.adminPassword }, origin, dir, titles })));
  const result = cli(['run-code', '--filename', file]);
  writeFileSync(join(dir, 'browser-result.txt'), result);
  const section = result.match(/### Result\r?\n([\s\S]*?)(?:\r?\n### |$)/);
  const accepted = section ? JSON.parse(section[1].trim()) : null;
  if (accepted?.ok !== true || accepted.checks?.length < 6) throw Error(result);
  console.log(result);
} finally {
  try { cli(['close']); } catch {}
  rmSync(file, { force: true });
  for (const id of ids) await request('/api/connector-assembly-manuals/' + id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmText: 'DELETE_MANUAL' }) }).catch(error => console.error('Fixture soft-delete: ' + error.message));
}

