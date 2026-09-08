/** Independently verify the published immutable home release and every mirror blob. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = process.env.EXPECTED_APP_VERSION;
const revision = process.env.EXPECTED_APP_REVISION;
assert.match(version || '', /^v\d+\.\d+\.\d+$/, 'EXPECTED_APP_VERSION must be a fixed version tag');
assert.match(revision || '', /^[a-f0-9]{40}$/, 'EXPECTED_APP_REVISION must be the full release commit');
const repository = 'gy3117577403-ai/hongmeng';
const upstreamRegistry = 'ghcr.io';
const mirrorRegistry = 'ghcr.dockerproxy.net';
const accept = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
const evidencePath = process.env.HOME_MIRROR_EVIDENCE || `artifacts/home-industrial-${version.replaceAll('.', '')}/mirror-verification.json`;
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 90_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 3000));
    }
  }
  throw lastError;
}

async function main() {
  // GHCR issues a scoped read token for public images without any account credentials.
  const tokenResponse = await request(`https://${upstreamRegistry}/token?service=ghcr.io&scope=repository:${repository}:pull`);
  const { token } = await tokenResponse.json();
  assert.ok(token, 'Upstream public read token is unavailable');
  const upstreamResponse = await request(`https://${upstreamRegistry}/v2/${repository}/manifests/${version}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}` },
  });
  const upstreamBody = Buffer.from(await upstreamResponse.arrayBuffer());
  const upstreamDigest = hash(upstreamBody);
  const declaredDigest = upstreamResponse.headers.get('docker-content-digest');
  if (declaredDigest) assert.equal(upstreamDigest, declaredDigest, 'Upstream manifest bytes do not match its declared digest');
  if (process.env.EXPECTED_IMAGE_DIGEST) assert.equal(upstreamDigest, process.env.EXPECTED_IMAGE_DIGEST);
  const mirrorResponse = await request(`https://${mirrorRegistry}/v2/${repository}/manifests/${version}`, { headers: { Accept: accept } });
  const mirrorBody = Buffer.from(await mirrorResponse.arrayBuffer());
  assert.equal(hash(mirrorBody), upstreamDigest, 'Mirror tag does not resolve to the exact upstream manifest');
  const manifest = JSON.parse(mirrorBody.toString('utf8'));
  assert.ok(manifest.config?.digest && manifest.layers?.length, 'Expected the release single-platform manifest');
  const verifiedBlobs = [];
  let imageConfig;
  for (const descriptor of [manifest.config, ...manifest.layers]) {
    let verified;
    let lastError;
    for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
      try {
        const response = await request(`https://${mirrorRegistry}/v2/${repository}/blobs/${descriptor.digest}`, { timeoutMs: 300_000 });
        const digest = createHash('sha256');
        const configChunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          digest.update(chunk);
          bytes += chunk.length;
          if (descriptor === manifest.config) configChunks.push(Buffer.from(chunk));
        }
        assert.equal(`sha256:${digest.digest('hex')}`, descriptor.digest, 'Mirror blob content digest mismatch');
        assert.equal(bytes, descriptor.size, 'Mirror blob byte length mismatch');
        if (descriptor === manifest.config) imageConfig = JSON.parse(Buffer.concat(configChunks).toString('utf8'));
        verified = { digest: descriptor.digest, bytes };
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
      }
    }
    if (!verified) throw lastError;
    verifiedBlobs.push(verified);
    console.log(`Verified anonymous mirror blob ${verified.digest} (${verified.bytes} bytes)`);
  }
  assert.equal(imageConfig.os, 'linux');
  assert.equal(imageConfig.architecture, 'amd64');
  assert.equal(imageConfig.config.Labels['org.opencontainers.image.version'], version);
  assert.equal(imageConfig.config.Labels['org.opencontainers.image.revision'], revision);
  const evidence = {
    verifiedAt: new Date().toISOString(), version, revision, platform: 'linux/amd64',
    digest: upstreamDigest, upstream: `${upstreamRegistry}/${repository}:${version}`,
    mirror: `${mirrorRegistry}/${repository}:${version}`,
    pinnedMirror: `${mirrorRegistry}/${repository}@${upstreamDigest}`,
    anonymous: true, verifiedBlobs, totalBytes: verifiedBlobs.reduce((total, blob) => total + blob.bytes, 0),
    runtimeAcceptance: 'Separate clean PostgreSQL/MinIO startup and browser acceptance are required.',
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
