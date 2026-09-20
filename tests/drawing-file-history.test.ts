import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingFileHistory } from '../lib/drawing-file-history';

test('document timestamps follow content lineage, never editable metadata', () => {
  const a = { id: 'a', originalName: 'a.pdf', version: 'V1', sourceType: 'MANUAL_UPLOAD', createdAt: new Date('2026-09-01T10:00:00Z') };
  const b = { ...a, id: 'b', version: 'V2', supersedesFileId: 'a', createdAt: new Date('2026-09-20T10:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') };
  const result = drawingFileHistory(b, [a,b]);
  assert.equal(result.firstUploadedAt, a.createdAt.toISOString());
  assert.equal(result.contentChangedAt, b.createdAt.toISOString());
  assert.deepEqual(result.history.map(h => h.id), ['b','a']);
  assert.equal(drawingFileHistory(a, [a]).contentChangedAt, null);
});
test('missing origins, imported history and cycles do not fabricate upload dates', () => {
  const a = { id: 'a', originalName: 'old.pdf', version: 'V1', sourceType: 'RESOURCE_SYNC', createdAt: new Date() };
  assert.equal(drawingFileHistory(a, [a]).firstUploadedAt, null);
  assert.equal(drawingFileHistory(a, [a]).timeKind, 'RECORD');
  const b = { ...a, sourceType:'MANUAL_UPLOAD', supersedesFileId: 'missing' };
  assert.equal(drawingFileHistory(b,[b]).firstUploadedAt, null);
  const c = { ...b, supersedesFileId:'a' };
  assert.equal(drawingFileHistory(c,[c]).history.length, 1);
  assert.equal(drawingFileHistory(c,[c]).firstUploadedAt, null);
});
