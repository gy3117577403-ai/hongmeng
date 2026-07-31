import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteObjectsBestEffort, s3ObjectKeyFingerprint } from '../lib/s3';

test('best-effort S3 cleanup reports failures without exposing keys or error messages', async () => {
  const objectKey = 'private/customer-a/sop/source-document.pdf';
  const secretMessage = 'Access denied for secret endpoint and object key';
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    const error = Object.assign(new Error(secretMessage), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const summary = await deleteObjectsBestEffort([objectKey, objectKey], async () => { throw error; });
    assert.deepEqual(summary, { requested: 1, deleted: 0, failed: 1 });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(calls.length, 1);
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /best-effort object deletion failed/);
  assert.match(serialized, /AccessDenied/);
  assert.match(serialized, /403/);
  assert.match(serialized, new RegExp(s3ObjectKeyFingerprint(objectKey)));
  assert.equal(serialized.includes(objectKey), false);
  assert.equal(serialized.includes(secretMessage), false);
});

test('best-effort S3 cleanup summarizes mixed outcomes', async () => {
  const removed: string[] = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let summary;
  try {
    summary = await deleteObjectsBestEffort(['one', '', 'two'], async key => {
      if (key === 'two') throw new Error('failure');
      removed.push(key);
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(removed, ['one']);
  assert.deepEqual(summary, { requested: 2, deleted: 1, failed: 1 });
});
