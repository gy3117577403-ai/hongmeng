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

const expectedPackageVersion = '1.31.3';
const expectedImageVersion = `v${expectedPackageVersion}`;

test('release version stays aligned across npm, Docker, and GHCR publishing', () => {
  assert.equal(packageJson.version, expectedPackageVersion);
  assert.equal(packageLock.version, expectedPackageVersion);
  assert.equal(packageLock.packages['']?.version, expectedPackageVersion);
  assert.match(dockerfile, new RegExp(`^ARG APP_VERSION=${expectedImageVersion}$`, 'm'));
  assert.match(workflow, /^\s+tags: \["v\*"\]$/m);
  assert.match(workflow, /^\s+type=ref,event=tag$/m);
  assert.match(workflow, new RegExp(`^\\s+APP_VERSION=${expectedImageVersion}$`, 'm'));
  assert.match(workflow, /^\s+- name: Verify release tag matches package version$/m);
});

test('GHCR images retain immutable traceability tags and OCI identity labels', () => {
  assert.match(workflow, /^\s+type=raw,value=latest$/m);
  assert.match(workflow, /^\s+type=sha$/m);
  assert.match(workflow, /^\s+group: docker-image-release$/m);
  assert.match(workflow, /^\s+cancel-in-progress: false$/m);
  assert.match(workflow, /^\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m);
  assert.match(workflow, /^\s+org\.opencontainers\.image\.title=hongmeng-workorder-resource$/m);
  assert.match(workflow, new RegExp(
    `^\\s+org\\.opencontainers\\.image\\.version=${expectedImageVersion}$`,
    'm',
  ));
  assert.match(workflow, /^\s+org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}$/m);
  assert.match(
    workflow,
    /^\s+org\.opencontainers\.image\.source=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}$/m,
  );
  assert.match(workflow, /^\s+labels: \$\{\{ steps\.meta\.outputs\.labels \}\}$/m);
  assert.match(workflow, /^\s+- name: Smoke test exact release image$/m);
  assert.match(workflow, /^\s+- name: Push verified release image$/m);
});
