import assert from 'node:assert/strict';
import test from 'node:test';
import { TERMINAL_TOOLING_POSITIONS, buildTerminalToolingImportPreview, parseTerminalToolingBlade, terminalToolingCsv, terminalToolingImportRowInput, validateTerminalToolingPublish } from '../lib/terminal-tooling';

const specs = () => TERMINAL_TOOLING_POSITIONS.map((position, index) => ({ position, specification: `${index + 1}.2×1.5`, dimensionA: `${index + 1}.2`, dimensionB: '1.5', material: `材质${index}`, hardness: `硬度${index}`, remark: `独立备注${index}`, supplierLinks: [
  { supplierName: `来源${index}`, supplierSku: `SKU-${index}`, productUrl: `https://example.com/${index}`, remark: '首选' },
  { supplierName: '备用来源', supplierSku: '', productUrl: '', remark: '另行询价' },
] }));

test('four position payload preserves independent dimensions, materials and suppliers', () => {
  const result = parseTerminalToolingBlade({ model: 'B-4', positionSpecs: specs() });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data?.positionSpecs.map(spec => spec.dimensionA), ['1.2', '2.2', '3.2', '4.2']);
  assert.deepEqual(result.data?.positionSpecs.map(spec => spec.supplierLinks[0].supplierSku), ['SKU-0', 'SKU-1', 'SKU-2', 'SKU-3']);
  assert.equal(result.data?.specification, null);
  assert.deepEqual(result.data?.compatiblePositions, TERMINAL_TOOLING_POSITIONS);
});

test('complete save requires four confirmed specs; drafts accept missing positions but validate supplied values', () => {
  const partial = specs().slice(0, 3);
  assert.match(parseTerminalToolingBlade({ model: 'B', positionSpecs: partial }).errors.join(), /下内刀/);
  assert.ok(parseTerminalToolingBlade({ model: 'B', isDraft: true, positionSpecs: partial }).data);
  assert.ok(parseTerminalToolingBlade({ model: 'B', isDraft: true, positionSpecs: [] }).data);
  assert.match(parseTerminalToolingBlade({ model: 'B', isDraft: true, positionSpecs: [{ ...partial[0], dimensionA: '-1' }] }).errors.join(), /上外刀尺寸A/);
  assert.equal(parseTerminalToolingBlade({ model: 'B', positionSpecs: {} }).data, null);
  assert.equal(parseTerminalToolingBlade({ model: 'B', positionSpecs: [partial[0], partial[0]] }).data, null);
  assert.match(parseTerminalToolingBlade({ model: 'B', positionSpecs: specs().map(row => ({ ...row, needsReview: true })) }).errors.join(), /核对/);
});

test('old shared inputs preserve only declared positions and require review when ambiguous', () => {
  const result = parseTerminalToolingBlade({ model: 'OLD', specification: '旧规格', compatiblePositions: ['UPPER_OUTER', 'LOWER_INNER'] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data?.positionSpecs.map(spec => spec.position), ['UPPER_OUTER', 'LOWER_INNER']);
  assert.ok(result.data?.positionSpecs.every(spec => spec.needsReview));
  const single = parseTerminalToolingBlade({ model: 'SINGLE', specification: '旧规格', compatiblePositions: ['UPPER_INNER'] });
  assert.equal(single.data?.positionSpecs[0].needsReview, false);
});

test('four-position CSV round trip preserves all suppliers, units, remarks and separate specs', () => {
  const original = parseTerminalToolingBlade({ model: '往返型号', manufacturer: '制造商', remark: '整组备注', positionSpecs: specs() }).data!;
  const text = terminalToolingCsv('blades', [original]);
  assert.match(text, /上外刀规格/);
  assert.match(text, /下内刀尺寸B/);
  const preview = buildTerminalToolingImportPreview({ entity: 'blades', text, existingKeys: new Set() });
  assert.equal(preview.rows[0].status, 'ready');
  const imported = parseTerminalToolingBlade(terminalToolingImportRowInput('blades', preview.rows[0])).data!;
  assert.deepEqual(imported.positionSpecs, original.positionSpecs);
  assert.equal(imported.remark, original.remark);
  assert.equal(imported.isDraft, false);
  assert.equal(buildTerminalToolingImportPreview({ entity: 'blades', text, existingKeys: new Set([original.normalizedKey]) }).rows[0].status, 'duplicate');
});

test('CSV invalid supplier JSON is a row error; legacy multi-position rows retain review status', () => {
  const invalid = buildTerminalToolingImportPreview({ entity: 'blades', existingKeys: new Set(), text: '刀片型号,上外刀规格,上外刀采购来源JSON\nB,1.2×3.4,invalid' });
  assert.equal(invalid.rows[0].status, 'invalid');
  assert.match(invalid.rows[0].reason, /采购来源JSON/);
  const legacy = buildTerminalToolingImportPreview({ entity: 'blades', existingKeys: new Set(), text: '刀片型号,适用刀位,规格\nOLD,上外刀；上内刀,旧规格' });
  assert.equal(legacy.rows[0].status, 'ready');
  assert.ok(parseTerminalToolingBlade(terminalToolingImportRowInput('blades', legacy.rows[0])).data?.positionSpecs.every(spec => spec.needsReview));
});

test('publication rejects missing, unreviewed, draft or incompatible position specification', () => {
  const blade = { isActive: true, compatiblePositions: [...TERMINAL_TOOLING_POSITIONS], isDraft: false, positionSpecs: specs().map(spec => ({ ...spec, needsReview: false })) };
  const positions = TERMINAL_TOOLING_POSITIONS.map(position => ({ position, blade }));
  assert.deepEqual(validateTerminalToolingPublish({ terminalActive: true, positions }), []);
  blade.positionSpecs[1].needsReview = true;
  assert.match(validateTerminalToolingPublish({ terminalActive: true, positions }).join(), /上内刀规格未确认/);
  blade.positionSpecs[1].needsReview = false;
  blade.isDraft = true;
  assert.equal(validateTerminalToolingPublish({ terminalActive: true, positions }).length, 4);
});
