import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const packageLock = JSON.parse(readFileSync(resolve(repositoryRoot, 'package-lock.json'), 'utf8')) as {
  version: string;
  packages: Record<string, { version?: string }>;
};
const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/docker-image.yml'), 'utf8');
const appInfo = readFileSync(resolve(repositoryRoot, 'lib/app-info.ts'), 'utf8');

const expectedPackageVersion = '1.34.65';
const expectedImageVersion = `v${expectedPackageVersion}`;

test('release version stays aligned across npm, Docker, and GHCR publishing', () => {
  assert.equal(packageJson.version, expectedPackageVersion);
  assert.equal(packageLock.version, expectedPackageVersion);
  assert.equal(packageLock.packages['']?.version, expectedPackageVersion);
  assert.match(dockerfile, new RegExp(`^ARG APP_VERSION=${expectedImageVersion}$`, 'm'));
  assert.match(appInfo, new RegExp(`APP_VERSION = process\\.env\\.APP_VERSION\\?\\.trim\\(\\) \\|\\| '${expectedImageVersion}'`));
  assert.match(workflow, /^\s+tags: \["v\*"\]$/m);
  assert.match(workflow, /^\s+type=ref,event=tag$/m);
  assert.match(workflow, /^\s+APP_VERSION=\$\{\{ github\.ref_name \}\}$/m);
  assert.match(workflow, /^\s+- name: Verify release tag matches package version$/m);
});

test('GHCR images retain immutable traceability tags and OCI identity labels', () => {
  assert.match(workflow, /^\s+type=raw,value=latest$/m);
  assert.match(workflow, /^\s+type=sha$/m);
  assert.match(workflow, /^\s+group: docker-image-release$/m);
  assert.match(workflow, /^\s+cancel-in-progress: true$/m);
  assert.match(workflow, /^\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m);
  assert.match(workflow, /^\s+org\.opencontainers\.image\.title=hongmeng-workorder-resource$/m);
  assert.match(workflow, /^\s+org\.opencontainers\.image\.version=\$\{\{ github\.ref_name \}\}$/m);
  assert.match(workflow, /^\s+org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}$/m);
  assert.match(
    workflow,
    /^\s+org\.opencontainers\.image\.source=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}$/m,
  );
  assert.match(workflow, /^\s+labels: \$\{\{ steps\.meta\.outputs\.labels \}\}$/m);
  assert.match(workflow, /^\s+- name: Smoke test exact release image$/m);
  assert.match(workflow, /^\s+- name: Verify PDF\.js runtime assets$/m);
  assert.match(workflow, /node scripts\/smoke-connector-manual-pdf\.mjs/);
  assert.match(workflow, /^\s+- name: Push verified release image$/m);
  assert.match(workflow, /^\s+declare -A pushed_tags=\(\)$/m);
  assert.match(workflow, /^\s+for attempt in \$\(seq 1 5\); do$/m);
  assert.match(workflow, /GHCR push failed after retries:/);
  assert.match(workflow, /^\s+- name: Verify Sealos China mirror manifest and blobs$/m);
  assert.match(workflow, /^\s+id: sealos_mirror$/m);
  assert.match(workflow, /^\s+continue-on-error: true$/m);
  assert.match(workflow, /^\s+timeout-minutes: 15$/m);
  assert.match(workflow, /timeout 30s docker buildx imagetools inspect/);
  assert.match(workflow, /--connect-timeout 10 --max-time 90/);
  assert.match(workflow, /\/blobs\/\$\{digest\}/);
  assert.match(workflow, /sha256sum "\$blob_file"/);
  assert.match(workflow, /Sealos blob verification failed after retries:/);
  assert.match(workflow, /^\s+- name: Record unavailable Sealos mirror without blocking GHCR release$/m);
});

test('release image changes the standalone application layer for every immutable release', () => {
  assert.match(dockerfile, /\.next\/standalone\/\.release-image\.json/);
  assert.match(dockerfile, /process\.env\.APP_VERSION/);
  assert.match(dockerfile, /process\.env\.APP_REVISION/);
});

test('runtime image explicitly carries both PDF.js worker variants', () => {
  assert.match(dockerfile, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  assert.match(dockerfile, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/);
});
