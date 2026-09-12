import assert from 'node:assert/strict';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

assert.equal(process.env.SMOKE_STORAGE_ALLOW, 'disposable-ci-storage');
const endpoint = new URL(process.env.S3_ENDPOINT || '');
assert.ok(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'Smoke storage must use the local disposable runtime');
const bucket = process.env.S3_BUCKET || 'workorder-resources';
assert.ok(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY, 'Smoke storage credentials are required');
const client = new S3Client({
  endpoint: endpoint.href,
  region: 'us-east-1',
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
let ready = false;
let lastError;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5000) });
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5000) });
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5000) });
      }
      ready = true;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 39) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!ready) throw new Error(`Smoke object storage did not become ready: ${lastError?.name || 'unknown'} ${lastError?.$metadata?.httpStatusCode || ''}`);
  console.log('Disposable smoke object storage is authenticated and the bucket is ready.');
} finally {
  client.destroy();
}
