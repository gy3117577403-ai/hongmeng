import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { completeProcessStep } from '../../lib/process-completion-service';
import { naturalProductionWeek } from '../../lib/production-execution';
import { productionDateKey } from '../../lib/production-control';

export async function productionForceCloseFixture(input: {
  scenario: 'voltage' | 'sleeve' | 'normal';
  user?: { id: string; username: string; displayName: string | null };
}) {
  const prefix = `FORCE-CLOSE-QA-${randomUUID().slice(0, 8)}`;
  const { scenario } = input;
  const now = new Date();
  const week = naturalProductionWeek(now);
  const user = input.user || await prisma.user.create({
    data: { username: prefix, displayName: '强制结单测试管理员', passwordHash: 'test-not-login', laborRole: 'ADMIN' },
  });
  const employee = await prisma.employee.create({
    data: { employeeNo: prefix, name: '报工测试人员', department: '生产', team: '测试' },
  });
  const stepSpecs = scenario === 'normal'
    ? [{ name: '包装' }]
    : [
        { name: '穿屏蔽环AB', actions: true },
        { name: '压屏蔽环', actions: true },
        { name: scenario === 'voltage' ? '打耐压' : '穿双壁管' },
        ...(scenario === 'sleeve' ? [{ name: '拆胶布', supplement: true }] : []),
        { name: '包装' },
      ];
  const order = await prisma.workOrder.create({
    data: {
      code: prefix, businessCode: prefix, specification: prefix,
      productName: scenario === 'voltage' ? '模拟 80502' : scenario === 'sleeve' ? '模拟 82602' : '普通完工对照',
      customerName: '隔离验收', stage: 'frontend', status: 'processing', planType: 'weekly_plan', planActive: true,
      productionTargetQty: 50, uncompletedQty: '50', completedQty: '0', frontendTransferredQty: 0,
      plannedAt: week.end, weekStartDate: week.start, weekEndDate: week.end, startedAt: now,
      processRoute: {
        create: {
          templateName: prefix, templateVersion: 1, status: 'in_progress', confirmedAt: now,
          confirmedById: user.id, startedAt: now, routeSource: 'integration_test',
          steps: { create: stepSpecs.map((step, index) => ({
            processCode: `${prefix}-${index + 1}`, processName: step.name,
            position: index + 1, sequenceGroup: index + 1,
            stageGroup: step.name === '包装' ? 'finish' : 'frontend',
            unitLabel: '套', timeBasis: 'per_unit', standardSource: 'integration_test', standardMillisecondsPerUnit: 20_000,
            unitsPerProduct: step.actions ? 2 : 1, reportQuantityBasis: step.actions ? 'action' : 'product',
            reportUnitLabel: step.actions ? '个' : '套',
            inputQty: index === 0 ? 50 : 0, status: index === 0 ? 'current' : 'pending',
            ...(step.supplement ? { executionMode: 'SUPPLEMENTAL_OBLIGATION' as const } : {}),
          })) },
        },
      },
    },
    include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  const route = order.processRoute!;
  if (scenario === 'sleeve') {
    const step = route.steps.find(step => step.processName === '拆胶布')!;
    const definition = await prisma.processDefinition.create({
      data: { code: step.processCode, name: step.processName, stageGroup: step.stageGroup },
    });
    await prisma.processSupplementObligation.create({
      data: {
        workOrderId: order.id, routeId: route.id, displayStepId: step.id,
        reconciliationKey: `existing-route:${step.id}`, source: 'EXISTING',
        processDefinitionId: definition.id, processCode: step.processCode, processName: step.processName,
        stageGroup: step.stageGroup, displayPosition: step.position, intendedSequenceGroup: step.sequenceGroup,
        requiredQty: 50, standardMillisecondsPerUnit: 20_000, unitLabel: '套',
      },
    });
  }
  const workDate = productionDateKey(now);
  let version = route.version;
  async function report(stepIndex: number, defectQty = 0) {
    const step = route.steps[stepIndex];
    const result = await completeProcessStep({
      routeId: route.id, stepId: step.id, processedQty: 50, defectQty,
      reportedUnitQty: step.reportQuantityBasis === 'action' ? 100 : undefined,
      reportedDefectUnitQty: step.reportQuantityBasis === 'action' ? defectQty * 2 : undefined,
      defectDisposition: defectQty ? 'rework' : undefined,
      employeeIds: [employee.id], requireParticipants: true, autoAssignLabor: true, allowAdvanceReporting: true,
      idempotencyKey: randomUUID(), expectedRouteVersion: version, workDate,
      userId: user.id, actor: user.username,
    });
    version = result.routeVersion;
    return result;
  }
  if (scenario !== 'normal') {
    await report(0);
    await report(1);
    await report(route.steps.length - 1);
  }
  return { order, route, user, employee, week, workDate, report, routeVersion: version };
}
