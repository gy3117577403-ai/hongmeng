import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTravelerPageManifest,
  paginateTravelerSteps,
  travelerPageCountForSteps,
  validateTravelerPageManifest,
} from '../lib/work-order-traveler-layout';

const steps = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

function flattened(pageCount: number, mode: 'auto' | 'single' | 'double' | 'custom' = 'auto') {
  const pages = paginateTravelerSteps(steps(35), { mode, customPageCount: pageCount });
  return { pages, values: pages.flatMap(page => page.steps) };
}

test('automatic layout starts a continuation page before the original 22-row clipping boundary', () => {
  assert.equal(travelerPageCountForSteps(22, { mode: 'auto' }), 1);
  assert.equal(travelerPageCountForSteps(23, { mode: 'auto' }), 2);
  assert.equal(travelerPageCountForSteps(35, { mode: 'auto' }), 2);
  assert.equal(travelerPageCountForSteps(49, { mode: 'auto' }), 3);
});

test('force-one-page layout keeps all 35 processes on one page', () => {
  const { pages, values } = flattened(1, 'single');
  assert.equal(pages.length, 1);
  assert.deepEqual(values, steps(35));
  assert.equal(pages[0]?.startIndex, 0);
  assert.equal(pages[0]?.endIndexExclusive, 35);
});

test('two-page layout distributes all 35 processes continuously without duplicates', () => {
  const { pages, values } = flattened(2, 'double');
  assert.equal(pages.length, 2);
  assert.deepEqual(values, steps(35));
  assert.equal(pages[0]?.endIndexExclusive, pages[1]?.startIndex);
  assert.equal(pages[1]?.endIndexExclusive, 35);
});

test('custom layout supports multiple pages and never creates blank process pages', () => {
  const { pages, values } = flattened(4, 'custom');
  assert.equal(pages.length, 4);
  assert.deepEqual(values, steps(35));
  assert.ok(pages.every(page => page.steps.length > 0));

  const shortPages = paginateTravelerSteps(steps(3), { mode: 'custom', customPageCount: 12 });
  assert.equal(shortPages.length, 3);
  assert.ok(shortPages.every(page => page.steps.length === 1));
});

test('server manifest validation accepts complete paging and rejects gaps or missing processes', () => {
  const pages = paginateTravelerSteps(steps(35), { mode: 'double' });
  const manifest = createTravelerPageManifest(35, pages, { mode: 'double' });
  assert.deepEqual(validateTravelerPageManifest(manifest, 35), manifest);

  const tampered = structuredClone(manifest);
  tampered.pages[1]!.startIndex += 1;
  assert.throws(
    () => validateTravelerPageManifest(tampered, 35),
    /工序范围不连续/,
  );

  assert.throws(
    () => validateTravelerPageManifest(manifest, 34),
    /工序总数不一致/,
  );
});
