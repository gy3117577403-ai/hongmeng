import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  confirmWorkOrderTravelerPrints,
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
      assert.deepEqual(first[0].items.map(item => item.material), ['TRAVELER']);
      assert.equal(first[0].items[0].status, 'GENERATED');

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

      const generatedTicket = await loadFieldReportTicket(first[0].publicCode, { recordScan: false });
      assert.equal(generatedTicket.route?.printedVersion, null);
      const confirmation = await confirmWorkOrderTravelerPrints({
        printIds: [second[0].printId],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(confirmation.confirmedCount, 1);
      const confirmedPrint = await loadWorkOrderTravelerPrints([second[0].printId]);
      assert.equal(confirmedPrint[0].items[0].status, 'CONFIRMED');

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

test(
  'drawing, SOP and traveler confirmations remain independent until the full packet is complete',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITQRM-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
    });
    const drawingCategory = await prisma.resourceCategory.upsert({
      where: { code: 'drawing' },
      update: {},
      create: { code: 'drawing', name: '图纸', sortOrder: 1 },
    });
    const sopCategory = await prisma.resourceCategory.upsert({
      where: { code: 'sop' },
      update: {},
      create: { code: 'sop', name: 'SOP', sortOrder: 2 },
    });
    const libraryItem = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        productName: 'print packet product',
        specification: `${prefix}-SPEC`,
        libraryKey: `${prefix}-LIBRARY`,
        files: {
          create: [
            {
              categoryId: drawingCategory.id,
              originalName: `${prefix}-drawing.webp`,
              mimeType: 'image/webp',
              size: 100,
              version: 'V1.0',
              objectKey: `integration/${prefix}/drawing.webp`,
              uploadedById: actor.id,
            },
            {
              categoryId: sopCategory.id,
              originalName: `${prefix}-sop.png`,
              mimeType: 'image/png',
              size: 100,
              version: 'V1.0',
              objectKey: `integration/${prefix}/sop.png`,
              uploadedById: actor.id,
            },
          ],
        },
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'print packet product',
        specification: `${prefix}-SPEC`,
        stage: 'frontend',
        status: 'processing',
        processName: 'cut',
        uncompletedQty: '12',
        productionTargetQty: 12,
        completedQty: '0',
        planType: 'managed_plan',
        planActive: true,
        drawingLibraryItemId: libraryItem.id,
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
                standardMillisecondsPerUnit: 2_000,
                setupMilliseconds: 0,
                unitsPerProduct: 1,
                countsForEfficiency: true,
                inputQty: 12,
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
      const [previousTraveler] = await createWorkOrderTravelerPrints({
        workOrderIds: [order.id],
        mode: 'TRAVELER_ONLY',
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      await confirmWorkOrderTravelerPrints({
        printIds: [previousTraveler.printId],
        materials: ['TRAVELER'],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      await prisma.$transaction([
        prisma.workOrderProcessRoute.update({ where: { id: order.processRoute.id }, data: { version: 2 } }),
        prisma.workOrderProcessStep.update({
          where: { id: order.processRoute.steps[0].id },
          data: { standardMillisecondsPerUnit: 3_000 },
        }),
      ]);
      const [packet] = await createWorkOrderTravelerPrints({
        workOrderIds: [order.id],
        mode: 'DRAWING_SOP_TRAVELER_SEPARATE',
        copies: 2,
        drawingImagePaperSize: 'A3',
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.deepEqual(packet.items.map(item => item.material).sort(), ['DRAWING', 'SOP', 'TRAVELER']);
      assert.ok(packet.items.every(item => item.copies === 2));
      assert.equal(packet.items.find(item => item.material === 'DRAWING')?.mimeType, 'image/webp');
      assert.equal(packet.items.find(item => item.material === 'SOP')?.mimeType, 'image/png');
      assert.equal(packet.snapshot.printRendering?.drawingImagePaperSize, 'A3');

      const firstConfirmation = await confirmWorkOrderTravelerPrints({
        printIds: [packet.printId],
        materials: ['TRAVELER'],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(firstConfirmation.confirmedCount, 1);
      const partial = await prisma.workOrderQrPrint.findUniqueOrThrow({
        where: { id: packet.printId },
        include: { items: true },
      });
      assert.equal(partial.status, 'GENERATED');
      assert.equal(partial.items.find(item => item.material === 'TRAVELER')?.status, 'CONFIRMED');
      assert.ok(partial.items.filter(item => item.material !== 'TRAVELER').every(item => item.status === 'GENERATED'));
      const partiallyConfirmedTicket = await loadFieldReportTicket(packet.publicCode, { recordScan: false });
      assert.equal(partiallyConfirmedTicket.route?.printedVersion, 2);
      assert.equal(partiallyConfirmedTicket.route?.steps[0].standardMillisecondsPerUnit, 3_000);

      await confirmWorkOrderTravelerPrints({
        printIds: [packet.printId],
        materials: ['SOP', 'DRAWING'],
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const complete = await prisma.workOrderQrPrint.findUniqueOrThrow({
        where: { id: packet.printId },
        include: { items: true },
      });
      assert.equal(complete.status, 'CONFIRMED');
      assert.ok(complete.items.every(item => item.status === 'CONFIRMED'));
    } finally {
      await prisma.workOrderQrPrint.deleteMany({ where: { ticket: { workOrderId: order.id } } });
      await prisma.workOrderQrTicket.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.drawingLibraryFile.deleteMany({ where: { libraryItemId: libraryItem.id } });
      await prisma.drawingLibraryItem.delete({ where: { id: libraryItem.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
