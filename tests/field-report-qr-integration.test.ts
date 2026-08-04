import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  createWorkOrderTravelerPrints,
  loadFieldReportTicket,
  loadWorkOrderTravelerPrints,
} from '../lib/work-order-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'one work order keeps one stable QR while every print preserves its route version',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITQR-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'QR traveler product',
        specification: `${prefix}-SPEC`,
        stage: 'frontend',
        status: 'processing',
        processName: 'cut',
        uncompletedQty: '24',
        productionTargetQty: 24,
        completedQty: '0',
        planType: 'managed_plan',
        planActive: true,
        processRoute: {
          create: {
            templateName: `${prefix} route`,
            templateVersion: 1,
            status: 'in_progress',
            version: 1,
            confirmedAt: new Date(),
            confirmedById: actor.id,
            startedAt: new Date(),
            routeSource: 'process_template',
            steps: {
              create: {
                processCode: `${prefix}-CUT`,
                processName: '裁线',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '套',
                standardMillisecondsPerUnit: 3_000,
                setupMilliseconds: 0,
                unitsPerProduct: 1,
                countsForEfficiency: true,
                inputQty: 24,
                status: 'current',
                startedAt: new Date(),
              },
            },
          },
        },
      },
      include: { processRoute: { include: { steps: true } } },
    });
    assert.ok(order.processRoute);

    try {
      const first = await createWorkOrderTravelerPrints({
        workOrderIds: [order.id],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(first.length, 1);
      assert.equal(first[0].snapshot.routeVersion, 1);
      assert.equal(first[0].snapshot.steps[0].standardMillisecondsPerUnit, 3_000);

      await prisma.$transaction([
        prisma.workOrderProcessRoute.update({
          where: { id: order.processRoute.id },
          data: { version: 2 },
        }),
        prisma.workOrderProcessStep.update({
          where: { id: order.processRoute.steps[0].id },
          data: { standardMillisecondsPerUnit: 6_000 },
        }),
      ]);
      const second = await createWorkOrderTravelerPrints({
        workOrderIds: [order.id],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(second[0].publicCode, first[0].publicCode);
      assert.equal(second[0].snapshot.routeVersion, 2);
      assert.equal(second[0].snapshot.steps[0].standardMillisecondsPerUnit, 6_000);

      const oldPrint = await loadWorkOrderTravelerPrints([first[0].printId]);
      assert.equal(oldPrint[0].snapshot.routeVersion, 1);
      assert.equal(oldPrint[0].snapshot.steps[0].standardMillisecondsPerUnit, 3_000);

      const ticket = await loadFieldReportTicket(first[0].publicCode, { recordScan: true });
      assert.equal(ticket.route?.version, 2);
      assert.equal(ticket.route?.printedVersion, 2);
      assert.equal(ticket.route?.steps[0].standardMillisecondsPerUnit, 6_000);
      assert.equal(ticket.access.canReport, true);
      const storedTicket = await prisma.workOrderQrTicket.findUniqueOrThrow({ where: { workOrderId: order.id } });
      assert.equal(storedTicket.scanCount, 1);
    } finally {
      await prisma.workOrderQrPrint.deleteMany({ where: { ticket: { workOrderId: order.id } } });
      await prisma.workOrderQrTicket.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
