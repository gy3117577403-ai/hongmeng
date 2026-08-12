import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTerminalToolingImportPreview,
  parseTerminalToolingBlade,
  parseTerminalToolingSetup,
  parseTerminalToolingTerminal,
  terminalToolingBladeKey,
  terminalToolingContextKey,
  terminalToolingCsv,
  terminalToolingTerminalKey,
  validateTerminalToolingPublish,
} from '../lib/terminal-tooling';

test('terminal and blade identity keys normalize width characters, case and whitespace', () => {
  assert.equal(terminalToolingTerminalKey(' 10075 ', ' TE '), terminalToolingTerminalKey('１００７５', 'te'));
  assert.equal(terminalToolingBladeKey('A 2.4×1.5', '刀模厂'), terminalToolingBladeKey('a2.4*1.5', '刀模厂'));
});

test('one terminal can have distinct setup contexts by wire, equipment and mold', () => {
  assert.notEqual(
    terminalToolingContextKey({ wireRange: '0.5 mm²', equipment: '半自动', mold: 'M01' }),
    terminalToolingContextKey({ wireRange: '0.75 mm²', equipment: '半自动', mold: 'M01' }),
  );
  assert.equal(
    terminalToolingContextKey({ wireRange: ' 0.5 MM² ', equipment: '半自动', mold: 'm01' }),
    terminalToolingContextKey({ wireRange: '0.5mm²', equipment: '半自动', mold: 'M01' }),
  );
});

test('terminal input validates supplier URLs and keeps reusable supplier metadata', () => {
  const parsed = parseTerminalToolingTerminal({
    specification: '10075',
    manufacturer: 'TE',
    aliases: '10075-A；旧10075',
    wireRange: '0.5–0.75 mm²',
    supplierLinks: [{ supplierName: '供应商A', supplierSku: 'SKU-1', productUrl: 'https://example.com/10075' }],
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data?.supplierLinks[0]?.supplierName, '供应商A');
  assert.deepEqual(parsed.data?.aliases, ['10075-A', '旧10075']);

  const unsafe = parseTerminalToolingTerminal({
    specification: '10075',
    supplierLinks: [{ supplierName: '错误来源', productUrl: 'javascript:alert(1)' }],
  });
  assert.equal(unsafe.data, null);
  assert.match(unsafe.errors.join('；'), /HTTP/);
});

test('blade requires at least one valid position and preserves raw plus structured dimensions', () => {
  const parsed = parseTerminalToolingBlade({
    model: 'UI-2415',
    compatiblePositions: ['UPPER_INNER'],
    specification: '2.4×1.5',
    dimensionA: '2.4',
    dimensionB: '1.5',
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data?.specification, '2.4×1.5');
  assert.equal(parsed.data?.dimensionA, '2.4');
  assert.equal(parseTerminalToolingBlade({ model: 'missing-position' }).data, null);
});

test('draft setup may be incomplete while publication requires four compatible active blades', () => {
  const draft = parseTerminalToolingSetup({
    terminalId: 'terminal-1',
    wireRange: '0.5 mm²',
    equipment: '半自动',
    mold: 'M01',
    tags: '垫纸；半自动压接；单模具',
    positions: [{ position: 'UPPER_OUTER', bladeId: 'blade-1' }],
  });
  assert.deepEqual(draft.errors, []);
  assert.equal(draft.data?.positions.length, 1);
  assert.deepEqual(draft.data?.tags, ['垫纸', '半自动压接', '单模具']);

  const errors = validateTerminalToolingPublish({
    terminalActive: true,
    positions: [{ position: 'UPPER_OUTER', blade: { isActive: true, compatiblePositions: ['UPPER_OUTER'] } }],
  });
  assert.equal(errors.length, 3);
  assert.match(errors.join('；'), /上内刀未配置/);

  const valid = validateTerminalToolingPublish({
    terminalActive: true,
    positions: [
      { position: 'UPPER_OUTER', blade: { isActive: true, compatiblePositions: ['UPPER_OUTER'] } },
      { position: 'UPPER_INNER', blade: { isActive: true, compatiblePositions: ['UPPER_INNER'] } },
      { position: 'LOWER_OUTER', blade: { isActive: true, compatiblePositions: ['LOWER_OUTER'] } },
      { position: 'LOWER_INNER', blade: { isActive: true, compatiblePositions: ['LOWER_INNER'] } },
    ],
  });
  assert.deepEqual(valid, []);
});

test('CSV preview recognizes terminal and blade headers and rejects duplicates', () => {
  const terminalText = '端子规格,制造商,适用线径,供应商,供应商链接\n10075,TE,0.5-0.75,供应商A,https://example.com/a\n10075,TE,0.5-0.75,供应商A,https://example.com/a';
  const terminalPreview = buildTerminalToolingImportPreview({ entity: 'terminals', text: terminalText, existingKeys: new Set() });
  assert.ok(terminalPreview.recognizedHeaders >= 2);
  assert.equal(terminalPreview.rows[0]?.status, 'ready');
  assert.equal(terminalPreview.rows[1]?.status, 'duplicate');

  const bladeText = '刀片型号,适用刀位,规格\nUI-2415,上内刀,2.4×1.5';
  const bladePreview = buildTerminalToolingImportPreview({ entity: 'blades', text: bladeText, existingKeys: new Set() });
  assert.equal(bladePreview.rows[0]?.status, 'ready');
});

test('CSV export retains every supplier instead of silently dropping later sources', () => {
  const exported = terminalToolingCsv('terminals', [{
    specification: '10075',
    manufacturer: 'TE',
    supplierLinks: [
      { supplierName: '供应商A', supplierSku: 'A-1', productUrl: 'https://example.com/a' },
      { supplierName: '供应商B', supplierSku: 'B-1', productUrl: 'https://example.com/b' },
    ],
    isActive: true,
  }]);
  assert.match(exported, /供应商A；供应商B/);
  assert.match(exported, /https:\/\/example\.com\/a；https:\/\/example\.com\/b/);
});
