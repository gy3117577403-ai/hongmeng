import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQualityWarningPages, flattenQualityWarningPages } from '../lib/quality-warning-print-layout';
import type { WorkOrderQualityWarningSnapshot } from '../lib/work-order-qr-service';
const warning = (overrides = {}) => ({ title: '压接尺寸异常', attachments: [], ...overrides } as unknown as WorkOrderQualityWarningSnapshot);

test('quality print retains every instruction and photo with readable continuation pages', () => {
  const steps = Array.from({ length: 35 }, (_, i) => `${i + 1}. 方案步骤 ${i + 1}：核对已批准参数并保留实测数据。`).join('\n');
  const photos = Array.from({ length: 11 }, (_, i) => ({ id: `image-${i}`, displayName: `照片${i}`, mimeType: 'image/png', contentUrl: `/image/${i}`, caption: `图片说明 ${i}`, printIncluded: true }));
  const input = warning({ correctiveAction: steps, attachments: photos });
  const pages = buildQualityWarningPages(input);
  assert.ok(pages.length >= 4, 'long content must use readable continuation pages');
  const text = pages.flatMap(page => page.blocks.flatMap(block => block.kind === 'text' ? block.lines : [])).join('\n');
  assert.match(text, /35. 方案步骤 35/);
  assert.deepEqual(pages.flatMap(page => page.blocks.flatMap(block => block.kind === 'photos' ? block.photos.map(photo => photo.id) : [])), photos.map(photo => photo.id));
  assert.equal(flattenQualityWarningPages([input, input]).length, pages.length * 2);
  assert.ok(pages.every(page => page.blocks.reduce((height, block) => height + block.heightMm + 3, 0) <= 210));
  assert.ok(pages.flatMap(page => page.blocks).filter(block => block.kind === 'photos').every(block => block.imageHeightMm >= 60));
});

test('quality print excludes optional empty fields without invented operational instructions', () => {
  const pages = buildQualityWarningPages(warning({ defectPhenomenon: '实测偏高', finalConclusion: '已确认' }));
  const text = JSON.stringify(pages);
  assert.ok(!text.includes('首件及巡检'));
  assert.ok(!text.includes('按归档方案执行'));
  assert.ok(text.includes('实测偏高'));
});

test('single photo full width and explicit print exclusion are respected', () => {
  const pages = buildQualityWarningPages(warning({ printPhotoLayout: 'SINGLE', attachments: [
    { id: 'one', mimeType: 'image/png', displayName: '异常局部', printIncluded: true },
    { id: 'hidden', mimeType: 'image/png', displayName: '不打印', printIncluded: false },
  ] }));
  const photos = pages.flatMap(page => page.blocks.filter(block => block.kind === 'photos'));
  assert.equal(photos.length, 1);
  assert.equal(photos[0].kind === 'photos' && photos[0].photos.length, 1);
  assert.ok(!JSON.stringify(photos).includes('hidden'));
});
