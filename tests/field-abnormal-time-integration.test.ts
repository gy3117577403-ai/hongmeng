import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createFieldAbnormalTimeEvent } from '../lib/field-abnormal-time-service';
import { prisma } from '../lib/prisma';
import {
  confirmWorkOrderTravelerPrints,
  createWorkOrderTravelerPrints,
} from '../lib/work-order-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'field abnormal time is idempotent and never changes report quantity or route completeness',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITABN-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-001`,
        name: `${prefix} worker`,
        department: '生产部',
        position: '装配',
        team: `${prefix}-TEAM`,
        isActive: true,
        attendanceEnabled: true,
      },
    });
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: employee.name,
        laborRole: 'EMPLOYEE',
        employeeId: employee.id,
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'abnormal-time product',
        specification: `${prefix}-SPEC`,
        stage: 'frontend',
        status: 'processing',
        processName: 'assembly',
        uncompletedQty: '50',
        productionTargetQty: 50,
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
                processCode: `${prefix}-ASSEMBLY`,
                processName: '装配',
                stageGroup: 'backend',
                position: 1,
                sequenceGroup: 1,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '套',
                standardMillisecondsPerUnit: 10_000,
                setupMilliseconds: 0,
                unitsPerProduct: 1,
                countsForEfficiency: true,
                inputQty: 50,
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
      const [print] = await createWorkOrderTravelerPrints({
        workOrderIds: [order.id],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      await confirmWorkOrderTravelerPrints({
        printIds: [print.printId],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const step = order.processRoute.steps[0];
      const before = await prisma.workOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          stage: true,
          completedQty: true,
          processRoute: { select: { status: true, version: true, steps: { select: { id: true, status: true, processedQty: true } } } },
        },
      });
      const key = `qra-${randomUUID()}`;
      const result = await createFieldAbnormalTimeEvent({
        code: print.publicCode,
        userId: actor.id,
        employeeId: employee.id,
        body: {
          stepId: step.id,
          category: 'training',
          workDate: '2026-08-13',
          durationMinutes: 30,
          employeeIds: [employee.id],
          reason: '',
          responsibilityDepartment: '',
          responsibilityObject: '',
          idempotencyKey: key,
        },
      });
      assert.equal(result.created, true);
      assert.equal(result.event.source, 'FIELD_REPORT');
      assert.equal(result.event.category, 'training');
      assert.equal(result.event.categoryLabel, '培训');
      assert.equal(result.event.qualityStatus, 'pending');
      assert.equal(result.event.employeeExempt, true);
      assert.equal(result.event.reason, null);
      assert.equal(result.event.responsibilityDepartment, null);
      assert.equal(result.event.responsibilityObject, null);
      assert.equal(result.event.durationMilliseconds, 30 * 60_000);
      assert.equal(result.event.startedAt, null);
      assert.equal(result.event.endedAt, null);
      assert.equal(result.event.allocations[0].employeeId, employee.id);

      const duplicate = await createFieldAbnormalTimeEvent({
        code: print.publicCode,
        userId: actor.id,
        employeeId: employee.id,
        body: {
          stepId: step.id,
          category: 'training',
          workDate: '2026-08-13',
          durationMinutes: 30,
          employeeIds: [employee.id],
          idempotencyKey: key,
        },
      });
      assert.equal(duplicate.created, false);
      assert.equal(duplicate.event.id, result.event.id);
      assert.equal(await prisma.abnormalTimeEvent.count({ where: { idempotencyKey: key } }), 1);

      const after = await prisma.workOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          stage: true,
          completedQty: true,
          processRoute: { select: { status: true, version: true, steps: { select: { id: true, status: true, processedQty: true } } } },
        },
      });
      assert.deepEqual(after, before);
    } finally {
      await prisma.abnormalTimeEvent.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderQrPrint.deleteMany({ where: { ticket: { workOrderId: order.id } } });
      await prisma.workOrderQrTicket.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: actor.id } });
      await prisma.employee.delete({ where: { id: employee.id } });
    }
  },
);
