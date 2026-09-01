import { prisma } from '../../../lib/prisma';
import { chinaWeekRange } from '../../../lib/production-planning';
import {
  enterWipWarehouse,
  scheduleWipLot,
} from '../../../lib/wip-warehouse';
import type { ProductionEntityScope } from '../../../lib/production-access-scope';

const fixtureCode = 'QA-WIP-13486-F129951528';
const username = 'qa_wip_admin';

const scope: ProductionEntityScope = {
  level: 'GLOBAL',
  canRead: true,
  canWrite: true,
  canReconcile: true,
  readOnly: false,
  teamKeys: [],
};

async function main() {
  const actor = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.user.update({
    where: { id: actor.id },
    data: { mustChangePassword: false },
  });

  const existing = await prisma.workOrder.findUnique({
    where: { code: fixtureCode },
    select: { id: true },
  });
  if (existing) {
    console.log(`fixture already exists: ${fixtureCode}`);
    return;
  }

  const currentWeek = chinaWeekRange(new Date());
  const workOrder = await prisma.workOrder.create({
    data: {
      code: fixtureCode,
      customerName: '福尔达',
      productName: '前门板氛围灯线束组件',
      specification: 'F129951528',
      planType: 'managed_plan',
      planActive: true,
      productionTargetQty: 4_000,
      uncompletedQty: '4,000',
      stage: 'frontend',
      status: 'in_progress',
      startedAt: currentWeek.start,
      materialTask: {
        create: {
          status: 'exception',
          exceptionType: 'missing_material',
          exceptionNote: '物料预计下周到齐，仅提示，不冻结开工',
          updatedById: actor.id,
        },
      },
      processRoute: {
        create: {
          templateName: 'F129951528 四工序路线',
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: currentWeek.start,
          confirmedById: actor.id,
          startedAt: currentWeek.start,
          steps: {
            create: [
              {
                processCode: 'F129951528-01',
                processName: '全自动',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                status: 'completed',
                inputQty: 4_000,
                processedQty: 4_000,
                goodOutputQty: 4_000,
                releasedGoodQty: 4_000,
                standardSource: 'qa_fixture',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 3_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
              {
                processCode: 'F129951528-02',
                processName: '包胶布',
                stageGroup: 'frontend',
                position: 2,
                sequenceGroup: 2,
                status: 'current',
                inputQty: 4_000,
                processedQty: 600,
                goodOutputQty: 600,
                releasedGoodQty: 600,
                standardSource: 'qa_fixture',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 25_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
              {
                processCode: 'F129951528-03',
                processName: '检验',
                stageGroup: 'frontend',
                position: 3,
                sequenceGroup: 3,
                status: 'pending',
                inputQty: 4_000,
                standardSource: 'qa_fixture',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 8_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
              {
                processCode: 'F129951528-04',
                processName: '包装',
                stageGroup: 'frontend',
                position: 4,
                sequenceGroup: 4,
                status: 'pending',
                inputQty: 4_000,
                standardSource: 'qa_fixture',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 2_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
            ],
          },
        },
      },
    },
  });

  const planOrder = await prisma.productionPlanOrder.create({
    data: {
      sourceOrderNo: fixtureCode,
      sourceLineNo: 1,
      customerName: '福尔达',
      productName: '前门板氛围灯线束组件',
      specification: 'F129951528',
      orderQuantity: 4_000,
      orderDate: currentWeek.start,
      customerDueDate: currentWeek.end,
      createdById: actor.id,
      updatedById: actor.id,
      batches: {
        create: {
          batchNo: 1,
          quantity: 4_000,
          weekStartDate: currentWeek.start,
          weekEndDate: currentWeek.end,
          plannedCompletionDate: currentWeek.end,
          releaseState: 'active',
          workOrderId: workOrder.id,
        },
      },
    },
    include: { batches: true },
  });

  const lot = await enterWipWarehouse({
    batchId: planOrder.batches[0].id,
    quantity: 4_000,
    reason: '物料到货日期不确定，保留已报工事实并转移剩余计划',
    actorId: actor.id,
    actorName: actor.displayName,
    idempotencyKey: `${fixtureCode}:enter`,
    productionScope: scope,
  });
  const allocation = await scheduleWipLot({
    lotId: lot.id,
    quantity: 4_000,
    targetWeekStartDate: currentWeek.start,
    reason: '先纳入本周有效计划，供改排交互验收',
    actorId: actor.id,
    actorName: actor.displayName,
    idempotencyKey: `${fixtureCode}:schedule`,
    productionScope: scope,
  });

  console.log(JSON.stringify({ fixtureCode, workOrderId: workOrder.id, lotId: lot.id, allocationId: allocation.id }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
