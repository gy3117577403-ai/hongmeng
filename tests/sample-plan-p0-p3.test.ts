import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { connectorParameterTechnicalFingerprint } from '../lib/connector-parameters';

test('connector parameter fingerprints normalize model case and full-width text', () => {
  const first = connectorParameterTechnicalFingerprint({ model: ' hvc-01 ', outerPeelMm: '３０', innerPeelMm: '13', insertionLengthMm: '55', remark: '' });
  const second = connectorParameterTechnicalFingerprint({ model: 'HVC-01', outerPeelMm: '30', innerPeelMm: '13', insertionLengthMm: '55', remark: null });
  assert.equal(first, second);
});

test('completed sample task deletion is admin-only, preview-bound, recoverable, and never deletes objects', () => {
  const deletion = readFileSync('lib/sample-task-deletion.ts', 'utf8');
  const route = readFileSync('app/api/sample-tasks/[id]/delete/route.ts', 'utf8');
  const migration = readFileSync('prisma/migrations/202609040002_sample_plan_media_parameters/migration.sql', 'utf8');
  assert.match(route, /requireSystemAdministrator/);
  assert.match(deletion, /status: 'COMPLETED'/);
  assert.match(deletion, /previewToken/);
  assert.match(deletion, /lastDeleteMutationId/);
  assert.match(deletion, /objectDeletionCount: 0/);
  assert.match(deletion, /restoreSampleTask/);
  assert.match(migration, /sample_task_cleanup_batches/);
});

test('photo viewer and drawing preview expose fit, rotate, zoom, center and fullscreen controls', () => {
  const viewer = readFileSync('components/ImageViewer.tsx', 'utf8');
  const sampleDialog = readFileSync('components/SamplePhotoViewerDialog.tsx', 'utf8');
  const drawing = readFileSync('components/DrawingLibraryShell.tsx', 'utf8');
  for (const contract of ['fit-window', '居中', 'showFullscreen']) assert.match(viewer, new RegExp(contract));
  assert.match(sampleDialog, /PageUp/);
  assert.match(sampleDialog, /PageDown/);
  assert.match(drawing, /initialFitMode="fit-window"/);
  assert.match(drawing, /参数数据/);
  assert.match(drawing, /附件证据/);
});

test('published connector edits create revisions and preserve superseded bindings', () => {
  const route = readFileSync('app/api/connector-parameters/[id]/route.ts', 'utf8');
  const publisher = readFileSync('lib/sample-team-publish.ts', 'utf8');
  assert.match(route, /sourceType: 'MANUAL_CORRECTION'/);
  assert.match(route, /supersedesParameterId: existing\.id/);
  assert.match(route, /status: 'SUPERSEDED'/);
  assert.match(route, /supersedesBindingId: binding\.id/);
  assert.match(publisher, /REPLACE_MATCHING/);
  assert.match(publisher, /positionKey/);
  assert.match(publisher, /technicalFingerprint/);
});
