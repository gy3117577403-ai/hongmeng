import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizedDatabaseUrl } from '../lib/prisma';

test('database URL receives bounded pool and connection timeout defaults', () => {
  const result = new URL(optimizedDatabaseUrl('postgresql://user:pass@db:5432/app?schema=public') || '');
  assert.equal(result.searchParams.get('connection_limit'), '10');
  assert.equal(result.searchParams.get('pool_timeout'), '10');
  assert.equal(result.searchParams.get('connect_timeout'), '10');
  assert.equal(result.searchParams.get('schema'), 'public');
});

test('explicit Prisma pool settings remain authoritative', () => {
  const result = new URL(optimizedDatabaseUrl('postgresql://user:pass@db:5432/app?connection_limit=4&pool_timeout=7') || '');
  assert.equal(result.searchParams.get('connection_limit'), '4');
  assert.equal(result.searchParams.get('pool_timeout'), '7');
});

