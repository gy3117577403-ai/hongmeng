import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_IMPORT_OFFICIAL_ORIGIN,
  normalizeLocalImportServiceOrigin,
} from '../lib/local-import-service-origin';

for (const input of [
  'https://qdowqencjyph.sealoshzh.site',
  'https://qdowqencjyph.sealoshzh.site/',
  'https://QDOWQENCJYPH.SEALOSHZH.SITE',
  'https://qdowqencjyph.sealoshzh.site:443',
  'https://qdowqencjyph.sealoshzh.site/api/local-import/tasks/pair',
]) {
  test(`normalizes allowed local-import origin: ${input}`, () => {
    assert.equal(normalizeLocalImportServiceOrigin(input), LOCAL_IMPORT_OFFICIAL_ORIGIN);
  });
}

for (const input of [
  'http://qdowqencjyph.sealoshzh.site',
  'https://qdowqencjyph.sealoshzh.site.evil.com',
  'https://evil-qdowqencjyph.sealoshzh.site',
  'https://user:pass@qdowqencjyph.sealoshzh.site',
  'https://qdowqencjyph.sealoshzh.site:8443',
  'file:///C:/temp/task.json',
  'ftp://qdowqencjyph.sealoshzh.site/task',
  'javascript:alert(1)',
  '/api/local-import/tasks/pair',
  'not a valid URL',
]) {
  test(`rejects untrusted local-import origin: ${input}`, () => {
    assert.throws(() => normalizeLocalImportServiceOrigin(input));
  });
}
