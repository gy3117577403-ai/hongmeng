import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessLegacyInsertedBinding,
  buildCorrectiveDraftEntries,
  type LegacyBindingAssessmentInput,
  type LegacyBindingFacts,
} from '../lib/process-route-change-binding-repair';

const emptyFacts: LegacyBindingFacts = {
  activeCompletions: 0,
  activeExecutions: 0,
  laborPools: 0,
  activeMovements: 0,
  processedQuantity: 0,
  reportedSupplementQuantity: 0,
};

function polluted(overrides: Partial<LegacyBindingAssessmentInput> = {}): LegacyBindingAssessmentInput {
  return {
    status: 'SUBMITTED',
    requestedName: '剥皮',
    boundDefinition: { id: 'definition-anchor', name: '合压' },
    anchorDefinitionId: 'definition-anchor',
    matchingDefinitionIds: ['definition-strip'],
    desiredDefinitionId: 'definition-strip',
    ...overrides,
  };
}

test('名称一致或绑定不是锚点定义时不识别为旧污染', () => {
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    requestedName: '合压',
  })), {
    affected: false,
    mode: 'NOT_AFFECTED',
    blockers: [],
  });
  assert.equal(assessLegacyInsertedBinding(polluted({
    anchorDefinitionId: 'definition-other',
  })).affected, false);
});

test('非 ACTIVE 且按名称唯一匹配时只修复 diff 绑定', () => {
  assert.deepEqual(assessLegacyInsertedBinding(polluted()), {
    affected: true,
    mode: 'DIFF_ONLY',
    blockers: [],
  });
});

test('无目标定义、同名多定义或正在启用均阻断', () => {
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    matchingDefinitionIds: [],
    desiredDefinitionId: null,
  })).blockers, ['REQUESTED_DEFINITION_MISSING']);
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    matchingDefinitionIds: ['definition-strip-a', 'definition-strip-b'],
    desiredDefinitionId: null,
  })).blockers, ['REQUESTED_DEFINITION_AMBIGUOUS']);
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    status: 'ACTIVATING',
  })).blockers, ['CHANGE_ACTIVATING']);
});

test('ACTIVE 且显示工序、正式版及 occurrence 唯一时可更正现有引用', () => {
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    status: 'ACTIVE',
    displayStepCount: 1,
    publishedProfileCount: 1,
    publishedEntryCount: 1,
    publishedEntryDefinitionId: 'definition-strip',
    repairDraftState: 'none',
    facts: emptyFacts,
  })), {
    affected: true,
    mode: 'ACTIVE_EXISTING_PROFILE',
    blockers: [],
  });
});

test('ACTIVE 正式版 occurrence 仍被污染时只允许创建纠正草稿', () => {
  assert.deepEqual(assessLegacyInsertedBinding(polluted({
    status: 'ACTIVE',
    displayStepCount: 1,
    publishedProfileCount: 1,
    publishedEntryCount: 1,
    publishedEntryDefinitionId: 'definition-anchor',
    repairDraftState: 'none',
    facts: emptyFacts,
  })), {
    affected: true,
    mode: 'ACTIVE_CORRECTIVE_DRAFT',
    blockers: [],
  });
});

test('ACTIVE 已有任一报工、执行、人工或数量事实时阻断', () => {
  const factCases: Array<keyof LegacyBindingFacts> = [
    'activeCompletions',
    'activeExecutions',
    'laborPools',
    'activeMovements',
    'processedQuantity',
    'reportedSupplementQuantity',
  ];
  for (const key of factCases) {
    const assessment = assessLegacyInsertedBinding(polluted({
      status: 'ACTIVE',
      displayStepCount: 1,
      publishedProfileCount: 1,
      publishedEntryCount: 1,
      publishedEntryDefinitionId: 'definition-anchor',
      repairDraftState: 'none',
      facts: { ...emptyFacts, [key]: 1 },
    }));
    assert.equal(assessment.mode, 'BLOCKED', key);
    assert.ok(assessment.blockers.includes('PRODUCTION_FACTS_EXIST'), key);
  }
});

test('ACTIVE 实例不唯一或发生身份冲突时阻断', () => {
  const assessment = assessLegacyInsertedBinding(polluted({
    status: 'ACTIVE',
    displayStepCount: 2,
    publishedProfileCount: 0,
    publishedEntryCount: 2,
    publishedEntryDefinitionId: 'definition-anchor',
    repairDraftState: 'none',
    identityConflicts: ['DISPLAY_STEP_CHANGED_BY_OTHER_WORK'],
    facts: emptyFacts,
  }));
  assert.equal(assessment.mode, 'BLOCKED');
  assert.deepEqual(assessment.blockers, [
    'DISPLAY_STEP_NOT_UNIQUE',
    'CURRENT_PUBLISHED_PROFILE_NOT_UNIQUE',
    'OCCURRENCE_ENTRY_NOT_UNIQUE',
    'DISPLAY_STEP_CHANGED_BY_OTHER_WORK',
  ]);
});

test('ACTIVE 存在业务草稿或纠正草稿的 occurrence 不唯一时阻断', () => {
  const base: Partial<LegacyBindingAssessmentInput> = {
    status: 'ACTIVE',
    displayStepCount: 1,
    publishedProfileCount: 1,
    publishedEntryCount: 1,
    publishedEntryDefinitionId: 'definition-anchor',
    facts: emptyFacts,
  };
  assert.ok(assessLegacyInsertedBinding(polluted({
    ...base,
    repairDraftState: 'business',
  })).blockers.includes('EXISTING_BUSINESS_DRAFT_CONFLICT'));
  assert.ok(assessLegacyInsertedBinding(polluted({
    ...base,
    repairDraftState: 'repair',
    repairDraftEntryCount: 0,
  })).blockers.includes('REPAIR_DRAFT_OCCURRENCE_NOT_UNIQUE'));
});

test('正式版 occurrence 被其他业务改成第三个定义时阻断', () => {
  const assessment = assessLegacyInsertedBinding(polluted({
    status: 'ACTIVE',
    displayStepCount: 1,
    publishedProfileCount: 1,
    publishedEntryCount: 1,
    publishedEntryDefinitionId: 'definition-third',
    repairDraftState: 'none',
    facts: emptyFacts,
  }));
  assert.equal(assessment.mode, 'BLOCKED');
  assert.ok(assessment.blockers.includes('PUBLISHED_ENTRY_CHANGED_BY_OTHER_WORK'));
});

test('纠正草稿保留全量 occurrenceKey 和工时字段，只改污染 occurrence', () => {
  const entries = [
    {
      id: 'entry-a', profileId: 'published', processDefinitionId: 'definition-a', occurrenceKey: 'occ-a',
      position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 10,
      actionMilliseconds: 10, occurrences: 1, setupMilliseconds: 0, unitLabel: '件',
      countsForEfficiency: true, remark: null,
    },
    {
      id: 'entry-polluted', profileId: 'published', processDefinitionId: 'definition-anchor',
      occurrenceKey: 'route-change:change-1:diff-1', position: 2, sequenceGroup: 2,
      timeBasis: 'per_unit', unitMilliseconds: 20, actionMilliseconds: 20, occurrences: 1,
      setupMilliseconds: 5, unitLabel: '件', countsForEfficiency: true, remark: '新增',
    },
  ];
  const cloned = buildCorrectiveDraftEntries(
    entries,
    'route-change:change-1:diff-1',
    'definition-strip',
  );
  assert.deepEqual(cloned.map(entry => entry.occurrenceKey), entries.map(entry => entry.occurrenceKey));
  assert.equal(cloned[0].processDefinitionId, 'definition-a');
  assert.deepEqual(cloned[1], {
    processDefinitionId: 'definition-strip',
    occurrenceKey: 'route-change:change-1:diff-1',
    position: 2,
    sequenceGroup: 2,
    timeBasis: 'per_unit',
    unitMilliseconds: 20,
    actionMilliseconds: 20,
    occurrences: 1,
    setupMilliseconds: 5,
    unitLabel: '件',
    countsForEfficiency: true,
    remark: '新增',
  });
  assert.throws(
    () => buildCorrectiveDraftEntries(entries, 'missing', 'definition-strip'),
    /not unique/,
  );
});
