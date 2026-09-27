import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// Browser acceptance is allowed only against a throwaway loopback runtime.
if (process.env.MATERIAL_COLLAB_QA_ALLOW !== 'disposable-material-runtime') throw Error('Disposable material collaboration runtime guard required');
const origin = process.env.MATERIAL_COLLAB_QA_BASE || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Loopback runtime required');
if (!process.env.MATERIAL_COLLAB_QA_FIXTURE) throw Error('Disposable fixture path required');
const fixture = JSON.parse(readFileSync(process.env.MATERIAL_COLLAB_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
if (!fixture.marker?.startsWith('mat-collab-') || !fixture.warehouseTaskId) throw Error('Unexpected fixture');
const dir = process.env.MATERIAL_COLLAB_QA_OUTPUT || 'artifacts/material-collaboration';
mkdirSync(dir, { recursive: true });
const codeFile = join(dir, 'browser-code.generated.cjs');

function cli(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const prefix = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')] : [];
  const result = spawnSync(command, [...prefix, '--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', '-s=material-collaboration-release', ...args], { encoding: 'utf8', timeout: 180000 });
  const output = ((result.stdout || '') + (result.stderr || ''))
    .replace(/### Ran Playwright code\r?\n```[\s\S]*?```(?:\r?\n)?/g, '')
    .replaceAll(fixture.password, '[disposable-password]');
  if (result.error || result.status) throw Error(result.error?.message || output);
  return output;
}

try {
  const scenario = readFileSync(new URL('./material-week-orders-browser-scenario.cjs', import.meta.url), 'utf8');
  const code = `async page => { ${scenario}; return scenario(page, ${JSON.stringify(origin)}, ${JSON.stringify(fixture)}, ${JSON.stringify(dir)}); }`;
  // Parse the generated browser program before invoking the CLI.
  new Function(`return (${code})`);
  if(process.argv.includes('--parse-only')) { console.log('Generated browser program parses'); process.exit(0); }
  writeFileSync(codeFile, code);
  cli(['open', origin + '/login']);
  const result = cli(['run-code', '--filename', codeFile]);
  writeFileSync(join(dir, 'browser-runtime.txt'), result);
  if (!/"passed":\s*true/.test(result)) throw Error(result);
  console.log(result);
} catch (error) {
  writeFileSync(join(dir, 'browser-failure.txt'), String(error).replaceAll(fixture.password, '[disposable-password]'));
  throw error;
} finally {
  rmSync(codeFile, { force: true });
  try { cli(['close']); } catch (error) { console.warn(String(error).replaceAll(fixture.password, '[disposable-password]')); }
}
