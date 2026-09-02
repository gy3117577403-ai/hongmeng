import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createProcessRows,
  createStrippingRows,
  hydrateProcessRows,
  serializeProcessRows,
  serializeStrippingRows,
  validateProcessRows,
  validateStrippingRows,
} from '../lib/sample-capture-mobile';

test('focused process editor starts with five rows and keeps unknown names as proposals', () => {
  const rows = createProcessRows();
  assert.equal(rows.length, 5);
  rows[0] = { ...rows[0], processName: '超声焊', seconds: '15.2' };
  const payload = serializeProcessRows(rows);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].processOrigin, 'PROPOSED');
  assert.equal(payload[0].processDefinitionId, null);
  assert.equal(payload[0].measuredMilliseconds, 15_200);
  assert.equal(payload[0].stageGroup, 'frontend');
});

test('process row validation rejects half-filled or non-positive labor time rows', () => {
  const rows = createProcessRows();
  rows[0] = { ...rows[0], processName: '裁线' };
  rows[1] = { ...rows[1], processName: '剥皮', seconds: '0' };
  const errors = validateProcessRows(rows);
  assert.match(errors[rows[0].rowId], /实测工时/);
  assert.match(errors[rows[1].rowId], /大于 0/);
});

test('section ui state restores blank process rows without turning them into payload records', () => {
  const rows = hydrateProcessRows({
    kind: 'PROCESS_TIME',
    revision: 2,
    payload: { rows: [{ rowId: 'p1', processName: '裁线', processDefinitionId: 'official-1', processOrigin: 'MASTER', measuredMilliseconds: 12_400 }] },
    uiState: { visibleRowCount: 7 },
  });
  assert.equal(rows.length, 7);
  assert.equal(serializeProcessRows(rows).length, 1);
  assert.equal(serializeProcessRows(rows)[0].processOrigin, 'MASTER');
  assert.equal(rows[0].seconds, '12.4');
});

test('stripping editor starts with one row and requires model plus at least one non-negative size', () => {
  const rows = createStrippingRows();
  assert.equal(rows.length, 1);
  rows[0] = { ...rows[0], outerPeelMm: '25' };
  assert.match(validateStrippingRows(rows)[rows[0].rowId], /型号/);
  rows[0] = { ...rows[0], model: 'T25BF2-80300', outerPeelMm: '-1' };
  assert.match(validateStrippingRows(rows)[rows[0].rowId], /大于或等于 0/);
  rows[0] = { ...rows[0], outerPeelMm: '25', innerPeelMm: '6', insertionLengthMm: '8' };
  assert.deepEqual(validateStrippingRows(rows), {});
  assert.equal(serializeStrippingRows(rows).length, 1);
});

test('mobile capture source exposes focused sections, server drafts, multi-photo queue, and explicit withdrawal', () => {
  const source = readFileSync('components/SampleCaptureMobile.tsx', 'utf8');
  assert.match(source, /sections\/\$\{kind\}/);
  assert.match(source, /expectedSectionRevision/);
  assert.match(source, /expectedTaskVersion/);
  assert.match(source, /PHOTO_DB_VERSION = 2/);
  assert.match(source, /type="file" accept="image\/\*" multiple/);
  assert.match(source, /capture="environment"/);
  assert.match(source, /Math\.min\(2, candidates\.length\)/);
  assert.match(source, /withdraw-submission/);
  assert.match(source, /withdrawMutationKey/);
  assert.match(source, /确认时自动收录/);
  assert.match(source, /还有未同步或上传失败的照片/);
});

test('focused mobile CSS keeps primary controls tablet-safe and touchable', () => {
  const css = readFileSync('app/sample-team-workbench.css', 'utf8');
  assert.match(css, /Focused sample capture V2/);
  assert.match(css, /\.sample-process-row/);
  assert.match(css, /\.sample-photo-grid-v2/);
  assert.match(css, /\.sample-photo-lightbox/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /width:\s*min\(430px, 100%\)/);
});
