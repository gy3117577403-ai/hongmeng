import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenError } from '../lib/auth';
import { assertSameOriginMutationRequest } from '../lib/request-origin';

test('same-origin mutation guard accepts the deployment origin and forwarded proxy origin', () => {
  assert.doesNotThrow(() => assertSameOriginMutationRequest(new Request('https://app.example/api/notifications/read-all', {
    method: 'PATCH',
    headers: { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
  })));
  assert.doesNotThrow(() => assertSameOriginMutationRequest(new Request('http://127.0.0.1:3000/api/notifications/read-all', {
    method: 'PATCH',
    headers: {
      origin: 'https://work.example',
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'work.example',
      'x-forwarded-proto': 'https',
    },
  })));
});

test('same-origin mutation guard rejects cross-site and mismatched origins', () => {
  assert.throws(() => assertSameOriginMutationRequest(new Request('https://app.example/api/notifications/read-all', {
    method: 'PATCH',
    headers: { 'sec-fetch-site': 'cross-site' },
  })), ForbiddenError);
  assert.throws(() => assertSameOriginMutationRequest(new Request('https://app.example/api/notifications/read-all', {
    method: 'PATCH',
    headers: { origin: 'https://evil.example' },
  })), ForbiddenError);
});
