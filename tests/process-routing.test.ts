import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReplaceDraftRouteWithProductTime,
  canResetLegacyDraftRouteToProductTimePending,
  initialProcessRouteStatus,
  normalizeProcessStageGroup,
  PRODUCT_TIME_PENDING_ROUTE_SOURCE,
  productTimeRouteActivation,
  processStageForGroup,
  validateProcessSteps,
} from '../lib/process-routing';

test('已发布产品工时自动生成已确认路线，未发布产品只保留待维护占位', () => {
  assert.equal(initialProcessRouteStatus('product_time_profile'), 'confirmed');
  assert.equal(initialProcessRouteStatus(PRODUCT_TIME_PENDING_ROUTE_SOURCE), 'draft');
});

test('只有完全未开始且没有报工记录的草稿路线可以由产品工时安全接管', () => {
  const pendingStep = {
    status: 'pending',
    startedAt: null,
    completedAt: null,
    _count: { executions: 0 },
  };
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'draft',
    startedAt: null,
    steps: [pendingStep],
  }), true);
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'draft',
    startedAt: null,
    steps: [{ ...pendingStep, _count: { executions: 1 } }],
  }), false);
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'in_progress',
    startedAt: new Date(),
    steps: [{ ...pendingStep, status: 'current' }],
  }), false);
});

test('旧模板只在未发图阶段转换为产品工序待发布，已进入生产的路线保持冻结', () => {
  const route = {
    status: 'draft',
    startedAt: null,
    steps: [{
      status: 'pending',
      startedAt: null,
      completedAt: null,
      _count: { executions: 0 },
    }],
  };
  assert.equal(canResetLegacyDraftRouteToProductTimePending(route, 'not_issued'), true);
  assert.equal(canResetLegacyDraftRouteToProductTimePending(route, 'frontend'), false);
  assert.equal(canResetLegacyDraftRouteToProductTimePending(route, 'backend'), false);
  assert.equal(canResetLegacyDraftRouteToProductTimePending(route, 'completed'), false);
});

test('产品工时只接管尚未开始的路线，并在图纸已发后自动启动首工序', () => {
  assert.deepEqual(productTimeRouteActivation('not_issued'), { status: 'confirmed', shouldStart: false });
  assert.deepEqual(productTimeRouteActivation('frontend'), { status: 'in_progress', shouldStart: true });
  assert.equal(productTimeRouteActivation('backend'), null);
  assert.equal(productTimeRouteActivation('completed'), null);
});

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
