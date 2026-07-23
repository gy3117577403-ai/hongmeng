import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProcessRouteServiceError,
  updateProcessRoute,
} from '../lib/process-route-service';
import {
  canReplaceDraftRouteWithProductTime,
  canResetLegacyDraftRouteToProductTimePending,
  canUpgradeUnstartedConfirmedProductTimeRoute,
  initialProcessRouteStatus,
  normalizeProcessStageGroup,
  PRODUCT_TIME_PENDING_ROUTE_SOURCE,
  productTimeRouteActivation,
  processStageForGroup,
  resolveCompletedProcessGroupTransition,
  validateProcessSteps,
} from '../lib/process-routing';

test('旧转序服务入口统一要求使用生产完成账本', async () => {
  await assert.rejects(
    updateProcessRoute({
      routeId: 'legacy-route',
      action: 'advance',
      expectedVersion: 0,
      userId: 'legacy-user',
      actor: 'legacy-user',
    }),
    (error: unknown) => error instanceof ProcessRouteServiceError
      && error.status === 410
      && error.code === 'PROCESS_COMPLETION_REQUIRED',
  );
});

test('已发布产品工时自动生成已确认路线，未发布产品只保留待维护占位', () => {
  assert.equal(initialProcessRouteStatus('product_time_profile'), 'confirmed');
  assert.equal(initialProcessRouteStatus(PRODUCT_TIME_PENDING_ROUTE_SOURCE), 'draft');
});

test('只有完全未开始且没有报工记录的草稿路线可以由产品工时安全接管', () => {
  const pendingStep = {
    status: 'pending',
    startedAt: null,
    completedAt: null,
    inputQty: 0,
    processedQty: 0,
    goodOutputQty: 0,
    defectOutputQty: 0,
    releasedGoodQty: 0,
    _count: { executions: 0, completions: 0 },
  };
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'draft',
    startedAt: null,
    steps: [pendingStep],
  }), true);
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'draft',
    startedAt: null,
    steps: [{ ...pendingStep, _count: { executions: 1, completions: 0 } }],
  }), false);
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'draft',
    startedAt: null,
    steps: [{ ...pendingStep, _count: { executions: 0, completions: 1 } }],
  }), false);
  assert.equal(canReplaceDraftRouteWithProductTime({
    status: 'in_progress',
    startedAt: new Date(),
    steps: [{ ...pendingStep, status: 'current' }],
  }), false);
});

test('已确认产品路线只有在完全未开工且没有生产事实时才随新版本升级', () => {
  const pendingStep = {
    status: 'pending',
    startedAt: null,
    completedAt: null,
    inputQty: 1_000,
    processedQty: 0,
    goodOutputQty: 0,
    defectOutputQty: 0,
    releasedGoodQty: 0,
    _count: { executions: 0, completions: 0 },
  };
  const route = {
    status: 'confirmed',
    routeSource: 'product_time_profile',
    startedAt: null,
    steps: [pendingStep],
  };

  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute(route), true);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    routeSource: PRODUCT_TIME_PENDING_ROUTE_SOURCE,
  }), true);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    routeSource: 'process_template',
  }), false);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    startedAt: new Date(),
  }), false);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    steps: [{ ...pendingStep, status: 'current' }],
  }), false);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    steps: [{ ...pendingStep, _count: { executions: 1, completions: 0 } }],
  }), false);
  assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
    ...route,
    steps: [{ ...pendingStep, _count: { executions: 0, completions: 1 } }],
  }), false);

  for (const field of ['processedQty', 'goodOutputQty', 'defectOutputQty', 'releasedGoodQty'] as const) {
    assert.equal(canUpgradeUnstartedConfirmedProductTimeRoute({
      ...route,
      steps: [{ ...pendingStep, [field]: 1 }],
    }), false, `${field} 已有生产事实时必须冻结快照`);
  }
});

test('旧模板只在未发图阶段转换为产品工序待发布，已进入生产的路线保持冻结', () => {
  const route = {
    status: 'draft',
    startedAt: null,
    steps: [{
      status: 'pending',
      startedAt: null,
      completedAt: null,
      inputQty: 0,
      processedQty: 0,
      goodOutputQty: 0,
      defectOutputQty: 0,
      releasedGoodQty: 0,
      _count: { executions: 0, completions: 0 },
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

test('产品工序路线校验保留并行顺序组', () => {
  const result = validateProcessSteps([
    { processCode: 'cutting', processName: '裁线', stageGroup: 'frontend', sequenceGroup: 1 },
    { processCode: 'stripping', processName: '剥皮', stageGroup: 'frontend', sequenceGroup: 2 },
    { processCode: 'crimping', processName: '压接', stageGroup: 'frontend', sequenceGroup: 2 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.steps.map(step => step.sequenceGroup), [1, 2, 2]);
});

test('并行工序组全部完成后才开放下一组', () => {
  const steps = [
    { id: 'cutting', sequenceGroup: 1, status: 'current' },
    { id: 'stripping', sequenceGroup: 1, status: 'current' },
    { id: 'crimping', sequenceGroup: 2, status: 'pending' },
    { id: 'inspection', sequenceGroup: 2, status: 'pending' },
  ];
  const first = resolveCompletedProcessGroupTransition(steps, 'cutting');
  assert.equal(first.groupCompleted, false);
  assert.deepEqual(first.activeStepIds, ['stripping']);

  const second = resolveCompletedProcessGroupTransition([
    { ...steps[0], status: 'completed' },
    steps[1],
    steps[2],
    steps[3],
  ], 'stripping');
  assert.equal(second.groupCompleted, true);
  assert.equal(second.nextSequenceGroup, 2);
  assert.deepEqual(second.nextStepIds, ['crimping', 'inspection']);
  assert.equal(second.routeCompleted, false);
});
