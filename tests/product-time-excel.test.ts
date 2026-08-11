import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductTimeExcelColumns,
  resolveProductTimeExcelColumn,
  restoreProductTimeExcelIdentities,
} from '@/lib/product-time-excel';

const definitions = [
  { id: 'strip', name: '剥皮' },
  { id: 'crimp', name: '压接' },
];

test('product time Excel layout creates one lossless column per repeated occurrence', () => {
  const columns = buildProductTimeExcelColumns(definitions, [
    { entries: [{ processDefinitionId: 'strip' }, { processDefinitionId: 'crimp' }, { processDefinitionId: 'strip' }] },
    { entries: [{ processDefinitionId: 'strip' }] },
  ]);

  assert.deepEqual(columns.map(column => [column.definitionId, column.occurrence, column.header]), [
    ['strip', 1, '剥皮#1'],
    ['strip', 2, '剥皮#2'],
    ['crimp', 1, '压接'],
  ]);
  assert.deepEqual(
    columns.map(column => {
      const parsed = resolveProductTimeExcelColumn(column.header, definitions);
      return [parsed?.definitionId, parsed?.occurrence];
    }),
    [['strip', 1], ['strip', 2], ['crimp', 1]],
  );
});

test('product time Excel parser recognizes occurrence suffixes and keeps plain headers compatible', () => {
  assert.deepEqual(resolveProductTimeExcelColumn('剥皮#2', definitions), {
    definitionId: 'strip',
    definitionName: '剥皮',
    occurrence: 2,
    header: '剥皮#2',
  });
  assert.equal(resolveProductTimeExcelColumn('压接', definitions)?.occurrence, 1);
  assert.equal(resolveProductTimeExcelColumn('合计(秒)', definitions), null);
});

test('product time Excel layout uses reversible encoded headers for reserved and #n collisions', () => {
  const collidingDefinitions = [
    ...definitions,
    { id: 'literal-suffix', name: '剥皮#1' },
    { id: 'reserved-total', name: '合计(秒)' },
    { id: 'literal-encoded', name: '__HM_PROCESS__strip#1' },
  ];
  const columns = buildProductTimeExcelColumns(collidingDefinitions, [{
    entries: [
      { processDefinitionId: 'strip' },
      { processDefinitionId: 'strip' },
      { processDefinitionId: 'literal-suffix' },
      { processDefinitionId: 'reserved-total' },
      { processDefinitionId: 'literal-encoded' },
    ],
  }]);

  assert.equal(new Set(columns.map(column => column.header)).size, columns.length);
  assert.ok(columns.find(column => column.definitionId === 'reserved-total')?.header.startsWith('__HM_PROCESS__'));
  assert.deepEqual(
    columns.map(column => {
      const parsed = resolveProductTimeExcelColumn(column.header, collidingDefinitions);
      return [parsed?.definitionId, parsed?.occurrence];
    }),
    columns.map(column => [column.definitionId, column.occurrence]),
  );
  assert.equal(resolveProductTimeExcelColumn('合计(秒)', collidingDefinitions), null);
});

test('product time Excel identity metadata restores exact keys and interleaved route positions', () => {
  const entries = [
    { columnHeader: '剥皮#1', processDefinitionId: 'strip', value: 6 },
    { columnHeader: '剥皮#2', processDefinitionId: 'strip', value: 9 },
    { columnHeader: '压接', processDefinitionId: 'crimp', value: 12 },
  ];
  const metadata = JSON.stringify([
    { header: '剥皮#1', definitionId: 'strip', occurrenceKey: 'strip-first', position: 1 },
    { header: '压接', definitionId: 'crimp', occurrenceKey: 'crimp', position: 2 },
    { header: '剥皮#2', definitionId: 'strip', occurrenceKey: 'strip-second', position: 3 },
  ]);

  const result = restoreProductTimeExcelIdentities(entries, metadata);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.metadataApplied, true);
  assert.deepEqual(
    result.entries.map(entry => [entry.columnHeader, entry.occurrenceKey]),
    [
      ['剥皮#1', 'strip-first'],
      ['压接', 'crimp'],
      ['剥皮#2', 'strip-second'],
    ],
  );
});

test('product time Excel rejects repeated occurrences when identity metadata is missing, corrupt, incomplete, or renamed', () => {
  const entries = [
    { columnHeader: '剥皮#1', processDefinitionId: 'strip' },
    { columnHeader: '剥皮#2', processDefinitionId: 'strip' },
    { columnHeader: '压接', processDefinitionId: 'crimp' },
  ];
  const completeMetadata = [
    { header: '剥皮#1', definitionId: 'strip', occurrenceKey: 'strip-first', position: 1 },
    { header: '压接', definitionId: 'crimp', occurrenceKey: 'crimp', position: 2 },
    { header: '剥皮#2', definitionId: 'strip', occurrenceKey: 'strip-second', position: 3 },
  ];

  assert.equal(restoreProductTimeExcelIdentities(entries, null).ok, false);
  assert.equal(restoreProductTimeExcelIdentities(entries, '{broken').ok, false);
  assert.equal(restoreProductTimeExcelIdentities(entries, JSON.stringify(completeMetadata.slice(0, 2))).ok, false);
  assert.equal(restoreProductTimeExcelIdentities(
    entries.map((entry, index) => index === 0 ? { ...entry, columnHeader: '剥皮新版#1' } : entry),
    JSON.stringify(completeMetadata),
  ).ok, false);
});

test('repeated-instance template requires metadata even when only one repeated column has a value', () => {
  const singleNonemptyOccurrence = [{
    columnHeader: '剥皮#1',
    processDefinitionId: 'strip',
    value: 6,
  }];
  assert.equal(restoreProductTimeExcelIdentities(
    singleNonemptyOccurrence,
    null,
    { requiresStableIdentity: true },
  ).ok, false);
  assert.equal(restoreProductTimeExcelIdentities(
    singleNonemptyOccurrence,
    '{broken',
    { requiresStableIdentity: true },
  ).ok, false);

  const valid = restoreProductTimeExcelIdentities(
    singleNonemptyOccurrence,
    JSON.stringify([{
      header: '剥皮#1',
      definitionId: 'strip',
      occurrenceKey: 'strip-first',
      position: 1,
    }]),
    { requiresStableIdentity: true },
  );
  assert.equal(valid.ok, true);
});

test('legacy single-occurrence Excel rows remain compatible without identity metadata', () => {
  const entries = [{ columnHeader: '压接', processDefinitionId: 'crimp', value: 12 }];
  const missing = restoreProductTimeExcelIdentities(entries, null);
  assert.equal(missing.ok, true);
  if (missing.ok) assert.equal(missing.metadataApplied, false);
  const corrupt = restoreProductTimeExcelIdentities(entries, '{broken');
  assert.equal(corrupt.ok, true);
  if (corrupt.ok) assert.match(corrupt.warning || '', /无效/);
});
