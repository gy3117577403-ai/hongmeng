import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { completeProcessStep } from '../../lib/process-completion-service';

export async function qualityFixture(options: { partialDownstream?: boolean; priorActions?: boolean; partialDefect?: boolean; noDownstream?: boolean } = {}) {
  const prefix = `QUALITY-TEST-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({ data: { username: prefix, displayName: '质量更正测试管理员', passwordHash: 'test-not-login', laborRole: 'ADMIN' } });
  const employee = await prisma.employee.create({ data: { employeeNo: prefix, name: '质量测试员工', department: '生产', team: '测试' } });
  const order = await prisma.workOrder.create({ data: {
    code: prefix, businessCode: prefix, productName: '质量数量更正测试产品', stage: 'frontend', status: 'processing', planType: 'managed_plan',
    productionTargetQty: 40, uncompletedQty: '40', completedQty: '0', frontendTransferredQty: 0, startedAt: new Date(),
    processRoute: { create: { templateName: prefix, templateVersion: 1, productTimeProfileVersion: 1, status: 'in_progress', version: 0,
      confirmedAt: new Date(), confirmedById: user.id, startedAt: new Date(), routeSource: 'product_time_profile', steps: { create: [
        { processCode: 'CODE', processName: '打号码管', position: 1, sequenceGroup: 1, stageGroup: 'frontend',
          reportQuantityBasis: 'action', reportUnitLabel: '个', timeBasis: 'per_unit', unitsPerProduct: options.priorActions ? 24 : 2,
          unitLabel: '套', standardSource: 'test', standardMillisecondsPerUnit: 5000, inputQty: 40, status: 'current' },
        { processCode: 'PACK', processName: '包装', position: 2, sequenceGroup: 2, stageGroup: 'backend',
          timeBasis: 'per_unit', unitsPerProduct: 1, unitLabel: '套', standardSource: 'test', standardMillisecondsPerUnit: 10000,
          inputQty: 0, status: 'pending' },
      ] } } },
  }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  const route = order.processRoute!;
  let version = 0;
  async function report(index: number, qty: number, defects: number, actions: number, badActions: number) {
    const result = await completeProcessStep({ routeId: route.id, stepId: route.steps[index].id, processedQty: qty, defectQty: defects,
      reportedUnitQty: actions, reportedDefectUnitQty: badActions, defectDisposition: defects ? 'rework' : undefined,
      workDate: '2026-11-11', employeeIds: [employee.id], requireParticipants: true, allowAdvanceReporting: true, autoAssignLabor: true,
      idempotencyKey: randomUUID(), expectedRouteVersion: version, userId: user.id, actor: user.username });
    version = result.routeVersion; return result;
  }
  if (options.priorActions) await report(0, 0, 0, 960, 0);
  if (!options.noDownstream) await report(1, options.partialDownstream ? 14 : 40, 0, options.partialDownstream ? 14 : 40, 0);
  const defectQty = options.partialDefect ? 20 : 40;
  const completion = await report(0, 40, defectQty, options.priorActions ? 40 : 80, options.priorActions ? 40 : defectQty * 2);
  return { user, employee, order, route, completion };
}
