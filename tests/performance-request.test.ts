import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientFetchError, fetchJson } from '../lib/client-fetch';

test('fetchJson returns structured JSON and never retries a write request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ ok: false, error: '保存失败', code: 'SAVE_FAILED', requestId: 'trace-1' }, { status: 503 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchJson('/api/example', { method: 'POST', retries: 3 }),
      (error: unknown) => error instanceof ClientFetchError
        && error.code === 'SAVE_FAILED'
        && error.requestId === 'trace-1',
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchJson retries a transient GET response once', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ ok: false, error: '暂时不可用' }, { status: 503 })
      : Response.json({ ok: true, value: 7 });
  }) as typeof fetch;
  try {
    const result = await fetchJson<{ ok: boolean; value: number }>('/api/example', { retries: 1 });
    assert.equal(result.value, 7);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

