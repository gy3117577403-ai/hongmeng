import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withSamplePhotoSerializableRetry } from '../app/api/sample-tasks/[id]/photos/serializable-retry';

function serializationFailure() {
  return Object.assign(new Error('write conflict or deadlock'), { code: 'P2034' });
}

test('sample photo append retries a fresh serializable transaction at most three times', async () => {
  let attempts = 0;
  const result = await withSamplePhotoSerializableRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw serializationFailure();
    return 'created';
  });
  assert.equal(result, 'created');
  assert.equal(attempts, 3);

  let failures = 0;
  await assert.rejects(
    withSamplePhotoSerializableRetry(async () => {
      failures += 1;
      throw serializationFailure();
    }),
    /write conflict or deadlock/,
  );
  assert.equal(failures, 3);
});

test('two photo workers sharing one base task version both complete after one P2034 replay', async () => {
  const baseTaskVersion = 5;
  const committed = new Set<string>();
  let secondWorkerFirstAttempt = true;
  const append = (worker: string) => withSamplePhotoSerializableRetry(async () => {
    assert.equal(baseTaskVersion, 5);
    if (worker === 'worker-2' && secondWorkerFirstAttempt) {
      secondWorkerFirstAttempt = false;
      throw serializationFailure();
    }
    committed.add(worker);
    return { worker, status: 201 };
  });

  const responses = await Promise.all([append('worker-1'), append('worker-2')]);
  assert.deepEqual(responses.map(item => item.status), [201, 201]);
  assert.deepEqual([...committed].sort(), ['worker-1', 'worker-2']);
});

test('photo bytes are uploaded once outside the bounded database retry loop', () => {
  const source = readFileSync('app/api/sample-tasks/[id]/photos/route.ts', 'utf8');
  const objectUpload = source.indexOf('await putObject({');
  const retryTransaction = source.indexOf('const photoResult = await withSamplePhotoSerializableRetry');
  assert.ok(objectUpload > 0);
  assert.ok(retryTransaction > objectUpload);
  assert.equal(source.match(/await putObject\(\{/g)?.length, 1);
  assert.match(source, /expectedTaskVersion > fresh\.version/);
  assert.doesNotMatch(source, /fresh\.version !== expectedTaskVersion/);
});
