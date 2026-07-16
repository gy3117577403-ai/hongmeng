import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProcessStageGroup,
  processStageForGroup,
  validateProcessSteps,
} from '../lib/process-routing';

test('标准全工序路线可以通过校验并保持顺序', () => {
  const names = [
    '裁线', '剥皮', '穿号码管', '压接', '压检', '焊接', '焊检',
    '套热缩管', '定位', '组装', '热缩', '导通', '检验', '包装',
  ];
  const result = validateProcessSteps(names.map((processName, index) => ({
    processCode: `process-${index + 1}`,
    processName,
    stageGroup: index < 5 ? 'frontend' : index < 13 ? 'backend' : 'finish',
  })));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.steps.length, 14);
  assert.deepEqual(result.steps.map(step => step.position), names.map((_, index) => index + 1));
  assert.deepEqual(result.steps.map(step => step.processName), names);
});

test('空路线、重复工序和非法分组会被拒绝', () => {
  assert.equal(validateProcessSteps([]).ok, false);
  assert.equal(validateProcessSteps([
    { processCode: 'cutting', processName: '裁线', stageGroup: 'frontend' },
    { processCode: 'cutting', processName: '重复裁线', stageGroup: 'frontend' },
  ]).ok, false);
  assert.equal(validateProcessSteps([
    { processCode: 'cutting', processName: '裁线', stageGroup: 'unknown' },
  ]).ok, false);
});

test('工序阶段分组只映射到兼容的生产汇总阶段', () => {
  assert.equal(normalizeProcessStageGroup('frontend'), 'frontend');
  assert.equal(normalizeProcessStageGroup('backend'), 'backend');
  assert.equal(normalizeProcessStageGroup('finish'), 'finish');
  assert.equal(normalizeProcessStageGroup('other'), null);
  assert.equal(processStageForGroup('frontend'), 'frontend');
  assert.equal(processStageForGroup('backend'), 'backend');
  assert.equal(processStageForGroup('finish'), 'backend');
});
