import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultCapabilityShowcaseContent,
  isCapabilityShowcaseImageRef,
  normalizeCapabilityShowcaseContent,
  referencedCapabilityShowcaseMediaIds,
} from '../lib/capability-showcase';
import { routeAccessRule } from '../lib/app-route-access';
import { apiRouteAccessRule } from '../lib/api-route-access';

test('default capability showcase is valid and includes the confirmed wire ranges', () => {
  const content = normalizeCapabilityShowcaseContent(defaultCapabilityShowcaseContent());
  assert.equal(content.schemaVersion, 1);
  assert.equal(content.sampleMode, true);
  assert.match(content.hero.highlight, /0\.1.*120/);
  assert.ok(content.processes.categories.some(category => category.coverage === '0.1–10 mm²'));
  assert.ok(content.processes.categories.some(category => category.coverage === '10–120 mm²'));
  assert.ok(content.products.categories.some(category => category.name === '高压线束'));
  assert.ok(content.products.categories.some(category => category.name === '机器人线束'));
});

test('only bundled showcase assets and opaque media references are accepted', () => {
  assert.equal(isCapabilityShowcaseImageRef('/assets/capability-showcase/hero-factory.png'), true);
  assert.equal(isCapabilityShowcaseImageRef('media:cm1234567890'), true);
  assert.equal(isCapabilityShowcaseImageRef('https://tracking.example/image.png'), false);
  assert.equal(isCapabilityShowcaseImageRef('javascript:alert(1)'), false);
});

test('uploaded media references are collected across hero, categories and entries', () => {
  const content = defaultCapabilityShowcaseContent();
  content.hero.image = 'media:hero12345678';
  content.products.categories[0].image = 'media:category1234';
  content.processes.categories[0].items[0].image = 'media:equipment123';
  const ids = referencedCapabilityShowcaseMediaIds(content);
  assert.deepEqual([...ids].sort(), ['category1234', 'equipment123', 'hero12345678']);
});

test('normalization rejects duplicate stable ids and untrusted image URLs', () => {
  const duplicate = defaultCapabilityShowcaseContent();
  duplicate.products.categories[0].id = duplicate.processes.categories[0].id;
  assert.throws(() => normalizeCapabilityShowcaseContent(duplicate), /编号重复/);

  const untrusted = defaultCapabilityShowcaseContent();
  untrusted.hero.image = 'https://example.com/untrusted.png';
  assert.throws(() => normalizeCapabilityShowcaseContent(untrusted), /图片引用/);
});

test('workbench uses the existing login baseline instead of introducing a new role', () => {
  const pageRule = routeAccessRule('/workspace/capability-showcase');
  assert.deepEqual(pageRule?.anyOf, ['ACCOUNT_SELF']);
  const apiRule = apiRouteAccessRule('/api/capability-showcase/publish');
  assert.deepEqual(apiRule?.anyOf, ['ACCOUNT_SELF']);
  assert.equal(apiRule?.actionsByMethod?.POST, 'UPDATE');
});
