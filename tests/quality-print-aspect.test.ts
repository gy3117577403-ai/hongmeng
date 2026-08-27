import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readQualityImageGeometry } from '../lib/quality-image-metadata';
import { buildQualityWarningPages } from '../lib/quality-warning-print-layout';
import type { WorkOrderQualityWarningSnapshot as Warning } from '../lib/work-order-qr-service';

const photo = (id: string, width = 1600, height = 900, extra = {}) => ({ id, imageWidth: width, imageHeight: height, displayName: id, caption: id, category: 'EVIDENCE', mimeType: 'image/jpeg', contentUrl: `/image/${id}`, ...extra });
const warning = (attachments: Warning['attachments'], extra = {}) => ({ title: '压接尺寸偏差', printLayoutVersion: 'ASPECT_V1', defectPhenomenon: '发现尺寸偏高', rootCause: '换型后参数未核对', correctiveAction: '重新调整并确认首件', attachments, ...extra } as Warning);
const blocks = (input: Warning) => buildQualityWarningPages(input).flatMap(page => page.blocks).filter(block => block.kind === 'photos');

test('three 16:9 pictures fit one A4 with short content and the third stays the same size', () => {
  const input = warning([photo('one'), photo('two'), photo('three')]);
  assert.equal(buildQualityWarningPages(input).length, 1);
  const rows = blocks(input);
  assert.equal(rows.length, 2); assert.equal(rows[1].columns, 2);
  assert.deepEqual(rows[1].sizes![0], rows[0].sizes![0]);
  const withConclusion = blocks({ ...input, finalConclusion: '复核已通过' });
  assert.deepEqual(withConclusion[1].sizes![0], withConclusion[0].sizes![0]);
});

test('1-12 mixed photos keep every pixel ratio, deterministic pages and all selected evidence', () => {
  const ratios = [[1600, 900], [900, 1600], [1200, 900], [900, 900], [3600, 600]];
  for (let count = 1; count <= 12; count++) {
    const photos = Array.from({ length: count }, (_, i) => photo(`p-${i}`, ...ratios[i % ratios.length] as [number, number]));
    for (const printPhotoLayout of ['PAIR', 'SINGLE'] as const) {
      const input = warning(photos, { printPhotoLayout });
      const pages = buildQualityWarningPages(input);
      assert.deepEqual(pages, buildQualityWarningPages(input));
      assert.deepEqual(blocks(input).flatMap(block => block.photos.map(p => p.id)), photos.map(p => p.id));
      for (const row of blocks(input)) row.photos.forEach((p, i) => {
        assert.ok(Math.abs(row.sizes![i].widthMm / row.sizes![i].heightMm - p.imageWidth! / p.imageHeight!) < 1e-10);
        assert.ok(row.sizes![i].widthMm <= (192 - (row.columns! - 1) * 3) / row.columns! - 3.09);
      });
      assert.ok(pages.every(page => page.blocks.reduce((sum, b) => sum + b.heightMm + 3, 0) <= 198));
    }
  }
});

test('three portraits can share a row, and paired before/after are indivisible', () => {
  const portraits = warning([photo('p1', 900, 1600), photo('p2', 900, 1600), photo('p3', 900, 1600)]);
  assert.equal(buildQualityWarningPages(portraits).length, 1);
  assert.equal(blocks(portraits)[0].columns, 3);
  const comparison = warning([photo('before', 1600, 900, { printGroup: '压接对照' }), photo('other'), photo('after', 900, 1600, { printGroup: '压接对照' })], { correctiveAction: Array(18).fill('确认参数').join('\n') });
  const grouped = blocks(comparison).find(block => block.group);
  assert.deepEqual(grouped!.photos.map(p => p.id), ['before', 'after']);
  assert.equal(grouped!.columns, 2);
  assert.ok(blocks(comparison).some(block => block.photos.some(p => p.id === 'other')));
});

test('long captions and solutions are retained; exclusion is explicit; input is never mutated', () => {
  const caption = Array(20).fill('这是一条必须保留的完整证据说明').join('，');
  const input = warning([photo('print', 1600, 900, { caption }), photo('online-only', 1600, 900, { printIncluded: false })], { correctiveAction: Array.from({ length: 35 }, (_, i) => `步骤${i + 1}：复核尺寸并记录结果`).join('\n') });
  const original = JSON.stringify(input);
  const pages = buildQualityWarningPages(input);
  assert.equal(JSON.stringify(input), original);
  const text = pages.flatMap(page => page.blocks.flatMap(b => b.kind === 'text' ? b.lines : [])).join('');
  assert.ok(text.includes(caption)); assert.ok(text.includes('步骤35'));
  assert.ok(!JSON.stringify(pages).includes('online-only'));
});

test('old issued snapshots keep legacy pages; new metadata absence fails instead of guessing square', () => {
  const input = warning([photo('one'), photo('two'), photo('three')]);
  const old = { ...input, printLayoutVersion: undefined };
  assert.equal(buildQualityWarningPages(old).length, 2);
  assert.ok(blocks(old).every(block => block.sizes === undefined));
  assert.throws(() => buildQualityWarningPages(warning([photo('bad', 0, 0)])), /尺寸/);
});

test('EXIF 1-8 are measured in displayed orientation without mutating original evidence', async () => {
  for (let orientation = 1; orientation <= 8; orientation++) {
    const bytes = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#ff6b00' } }).jpeg().withMetadata({ orientation }).toBuffer();
    const before = createHash('sha256').update(bytes).digest('hex');
    const geometry = await readQualityImageGeometry(bytes);
    assert.equal(geometry.imageWidth, orientation >= 5 ? 90 : 160);
    assert.equal(geometry.imageHeight, orientation >= 5 ? 160 : 90);
    assert.equal(geometry.imageOrientation, orientation);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), before);
  }
  await assert.rejects(readQualityImageGeometry(Buffer.from('not an image')));
});

test('long titles and multi-line order codes reserve header space without cutting pictures or text', () => {
  const input = warning([photo('large')], { title: '异常确认'.repeat(30), printHeaderExtraMm: 20, printPhotoLayout: 'SINGLE', correctiveAction: Array(35).fill('保留全部解决方案').join('\n') });
  const pages = buildQualityWarningPages(input);
  assert.ok(pages.every(page => page.blocks.reduce((sum, block) => sum + block.heightMm + 3, 0) <= 166));
  assert.equal(blocks(input).length, 1);
});
