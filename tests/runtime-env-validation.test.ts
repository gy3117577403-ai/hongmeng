import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../scripts/validate-runtime-env.mjs',
);

function runValidator(appBaseUrl?: string) {
  const env = { ...process.env };
  if (appBaseUrl === undefined) delete env.APP_BASE_URL;
  else env.APP_BASE_URL = appBaseUrl;

  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env,
  });
}

test('runtime APP_BASE_URL accepts a bare local or HTTPS origin', () => {
  for (const value of [
    undefined,
    '',
    'http://127.0.0.1:3000',
    'https://qdowqencjyph.sealoshzh.site',
    'https://qdowqencjyph.sealoshzh.site/',
  ]) {
    const result = runValidator(value);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('runtime APP_BASE_URL rejects duplicated schemes and non-origin parts', () => {
  for (const [value, expected] of [
    ['http://https://example.com', /bare http\(s\) origin/],
    ['https://example.com/path', /bare http\(s\) origin/],
    ['https://example.com?next=/dashboard', /bare http\(s\) origin/],
    [' https://example.com', /whitespace/],
  ] as const) {
    const result = runValidator(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});
