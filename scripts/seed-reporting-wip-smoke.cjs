// Isolated acceptance data. No existing work orders or production records are edited.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
if (process.env.REPORT_RECOVERY_QA_ALLOW !== 'disposable-reporting-runtime') throw Error('Disposable reporting runtime acknowledgement required');
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', 'db', 'postgres'].includes(url.hostname)) throw Error('Isolated database hostname required');
const fixture = JSON.parse(readFileSync(process.env.REPORT_RECOVERY_QA_FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
const db = new PrismaClient();
async function main() {
  const marker = 'QA-WIP-REPORT-' + randomUUID().slice(0, 8);
  const day = new Date(fixture.workDate + 'T00:00:00Z');
  const start = new Date(day); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const offset = days => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + days); return date; };
  const orders = {};
  const definition = await db.processDefinition.create({ data: { code: marker + '-TAPE', name: '包胶布', stageGroup: 'backend' } });
  for (const kind of ['expired', 'current', 'multiple', 'unscheduled', 'future', 'desktop']) {
    const order = await db.workOrder.create({ data: {
      code: marker + '-' + kind, customerName: '隔离报工验收客户', productName: '半成品线束', specification: marker + '-' + kind,
      planType: 'managed_plan', planActive: true, productionTargetQty: 40, uncompletedQty: '40', completedQty: '0', stage: 'backend', status: 'processing', startedAt: offset(-7),
      qrTicket: { create: { publicCode: randomUUID().replaceAll('-', '') } },
      processRoute: { create: { templateName: marker, templateVersion: 1, status: 'in_progress', version: 0,
        confirmedAt: offset(-7), confirmedById: fixture.users.admin.id, startedAt: offset(-7), steps: { create: {
          processDefinitionId: definition.id, processCode: definition.code, processName: definition.name, stageGroup: 'backend', position: 1, sequenceGroup: 1,
          status: 'current', inputQty: 40, standardSource: 'manual', timeBasis: 'per_unit', standardMillisecondsPerUnit: 15000,
          unitLabel: '件', reportQuantityBasis: 'product', reportUnitLabel: '件', unitsPerProduct: 1, countsForEfficiency: true,
        } } } },
    }, include: { qrTicket: true, processRoute: { include: { steps: true } } } });
    const plan = await db.productionPlanOrder.create({ data: {
      sourceOrderNo: marker + '-' + kind, sourceLineNo: 1, customerName: order.customerName, productName: order.productName, specification: order.specification,
      orderQuantity: 40, orderDate: offset(-7), customerDueDate: offset(6), createdById: fixture.users.admin.id, updatedById: fixture.users.admin.id,
      batches: { create: { batchNo: 1, quantity: 40, weekStartDate: offset(kind === 'desktop' ? -14 : -7), weekEndDate: offset(kind === 'desktop' ? -8 : -1), plannedCompletionDate: offset(6), releaseState: 'active', workOrderId: order.id } },
    }, include: { batches: true } });
    const lots = [];
    for (let index = 0; index < (kind === 'multiple' ? 2 : 1); index++) {
      const quantity = kind === 'multiple' ? 20 : 40;
      const lot = await db.semiFinishedLot.create({ data: {
        lotNo: marker + '-' + kind + '-' + (index + 1), productionPlanBatchId: plan.batches[0].id, workOrderId: order.id,
        routeId: order.processRoute.id, routeVersion: 0, sourceWeekStartDate: offset(kind === 'desktop' ? -14 : -7), sourceWeekEndDate: offset(kind === 'desktop' ? -8 : -1), quantity,
        nextStepIds: [order.processRoute.steps[0].id], scheduleStatus: kind === 'unscheduled' ? 'UNSCHEDULED' : 'SCHEDULED', reasonCode: 'OTHER', reason: '隔离验收半成品', enteredById: fixture.users.admin.id,
        steps: { create: { stepId: order.processRoute.steps[0].id, routeVersion: 0, processCode: definition.code, processName: definition.name, stageGroup: 'backend', position: 1,
          sequenceGroup: 1, timeBasis: 'per_unit', standardMillisecondsPerUnit: 15000, unitsPerProduct: 1, plannedQty: quantity, remainingQty: quantity,
          remainingStandardMilliseconds: BigInt(quantity * 15000), status: kind === 'unscheduled' ? 'UNSCHEDULED' : 'SCHEDULED' } },
      }, include: { steps: true } });
      let allocation = null;
      if (kind !== 'unscheduled') allocation = await db.wipWeekAllocation.create({ data: {
        lotId: lot.id, targetWeekStartDate: offset(kind === 'expired' ? -7 : kind === 'future' ? 7 : 0),
        targetWeekEndDate: offset(kind === 'expired' ? -1 : kind === 'future' ? 13 : 6),
        quantity, plannedStandardMilliseconds: BigInt(quantity * 15000), reason: '隔离验收周安排', scheduledById: fixture.users.admin.id,
        idempotencyKey: marker + ':' + kind + ':' + index,
        steps: { create: { lotStepId: lot.steps[0].id, plannedQty: quantity, plannedStandardMilliseconds: BigInt(quantity * 15000), status: 'SCHEDULED' } },
      } });
      lots.push({ id: lot.id, lotNo: lot.lotNo, allocationId: allocation?.id || null });
    }
    orders[kind] = { id: order.id, code: order.code, routeId: order.processRoute.id, stepId: order.processRoute.steps[0].id,
      publicCode: order.qrTicket.publicCode, lots };
  }
  return { marker, workDate: fixture.workDate, weekStart: offset(0).toISOString().slice(0, 10), weekEnd: offset(6).toISOString().slice(0, 10),
    lastWeekStart: offset(-7).toISOString().slice(0, 10), lastWeekEnd: offset(-1).toISOString().slice(0, 10), orders };
}
main().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
