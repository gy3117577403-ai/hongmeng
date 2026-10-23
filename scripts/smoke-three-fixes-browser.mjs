import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
assert.equal(process.env.THREE_FIXES_QA_ALLOW, 'disposable-three-fixes-runtime');
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const dir = resolve(process.env.THREE_FIXES_QA_OUTPUT || 'output/playwright/three-fixes').replaceAll('\\', '/');
const fixture = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')); assert.ok(fixture.marker.startsWith('TRI-'));
mkdirSync(dir, { recursive: true });
const generated = join(dir, 'browser-code.generated.cjs');
function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=three-fixes', ...args], { encoding: 'utf8', timeout: 480000 });
  const output = ((result.stdout || '') + (result.stderr || '')).replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '').replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}
async function scenario(page, origin, f, dir) {
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(String(e)));
  const check = (value, text) => { if (!value) throw Error(text); checks.push(text); };
  const shot = name => page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
  const target = '/workspace/procurement?scope=pool&status=all&q=' + f.marker + '&orderId=' + f.orderId;
  try {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto(origin + '/login?next=' + encodeURIComponent(target));
    await page.getByLabel('员工编号 / 管理账号').fill(f.username); await page.getByLabel('密码', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: f.marker, exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: /批量核验到料/ }).click();
    const modal = page.getByRole('dialog', { name: '批量核验到料' });
    check(await modal.getByRole('spinbutton', { name: /^可用数量/ }).count() === 3, 'three arrival batches can be verified together');
    await modal.getByLabel('同时确认产品可配套数量').check();
    check(await modal.getByLabel('累计可配套数量', { exact: true }).inputValue() === '', 'product sets require explicit physical input');
    await modal.getByLabel('累计可配套数量', { exact: true }).fill('25');
    await modal.getByLabel('已按实物核对；物料个数不直接换算为产品套数').check();
    await shot('01-batch-verification-tablet');
    await modal.getByRole('button', { name: '核验并确认配套' }).click(); await modal.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.mo-detail')?.textContent.includes('已配齐'));
    check((await page.locator('.mo-detail').innerText()).includes('25'), 'pool confirmation closes at 25 product sets'); await shot('02-material-closed');
    await page.goto(origin + '/workspace/purchases?record=' + f.lineId);
    await page.getByRole('button', { name: '更正垫付金额', exact: true }).last().click();
    const d = page.getByRole('dialog');
    await d.getByLabel('更正后采购总额（元）').fill('120');
    await d.getByLabel('操作原因 / 说明', { exact: true }).fill('报销时核对采购原件，入库后更正');
    await shot('03-correct-received-advance');
    await d.getByRole('button', { name: '确认保存', exact: true }).click(); await d.waitFor({ state: 'detached' });
    await page.getByRole('region', { name: '垫付金额更正记录' }).getByText(/¥100.00 → ¥120.00 · 已生效/).waitFor();
    check(true, 'received personal advance correction is available and audited');
    await shot('04-correction-audit');
    await page.evaluate(async id => {
      const detail = await (await fetch('/api/purchases?record=' + id)).json();
      const response = await fetch('/api/purchases', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ action: 'CREATE_FUND', entries: [{ id, version: detail.data.record.version }], amountCents: 12000 }) });
      if (!response.ok) throw Error(await response.text());
    }, f.lineId);
    await page.getByRole('button', { name: '更正垫付金额', exact: true }).last().click();
    await d.getByLabel('更正后采购总额（元）').fill('110');
    await d.getByLabel('操作原因 / 说明', { exact: true }).fill('已申请资金的价格复核');
    await d.getByRole('button', { name: '确认保存', exact: true }).click(); await d.waitFor({ state: 'detached' });
    await page.getByRole('region', { name: '垫付金额更正记录' }).getByRole('button', { name: '通过金额更正', exact: true }).click();
    await d.getByLabel('操作原因 / 说明', { exact: true }).fill('核对通过，按新金额申请');
    await d.getByRole('button', { name: '确认保存', exact: true }).click(); await d.waitFor({ state: 'detached' });
    await page.getByRole('region', { name: '垫付金额更正记录' }).getByText(/¥120.00 → ¥110.00 · 已生效/).waitFor();
    check(true, 'funded price correction can be reviewed from its dedicated tab'); await shot('05-correction-reviewed');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    check(!overflow, 'purchase correction fits the 1366 by 1024 tablet viewport');
    check(errors.length === 0, 'no browser errors: ' + JSON.stringify(errors));
    return { passed: true, checks };
  } catch (e) { await shot('failure').catch(() => {}); throw e; }
}
try {
  writeFileSync(generated, `async page => { const scenario=${scenario.toString()}; return scenario(page,${JSON.stringify(origin)},${JSON.stringify(fixture)},${JSON.stringify(dir)}); }`);
  cli(['open', origin + '/login']); const output = cli(['run-code', '--filename', generated]); writeFileSync(join(dir, 'acceptance.txt'), output);
  assert.match(output, /"passed":\s*true/); console.log(output);
} finally { rmSync(generated, { force: true }); try { cli(['close']); } catch {} }
