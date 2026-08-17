import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { publishSampleEntry } from '../lib/sample-team-publish';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'item review publishes product records while keeping process time in a draft and production ledgers untouched',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-SAMPLE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} reviewer`,
      },
    });
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        productName: 'sample product',
        specification: `${prefix}-PRODUCT`,
        libraryKey: `${prefix}-LIBRARY`,
      },
    });
    const processDefinition = await prisma.processDefinition.create({
      data: {
        code: `${prefix}-PROCESS`,
        name: `${prefix}-裁线`,
        stageGroup: 'frontend',
        sortOrder: 1,
      },
    });
    const task = await prisma.sampleTask.create({
      data: {
        code: `${prefix}-TASK`,
        qrCode: `${prefix}-QR`,
        drawingLibraryItemId: item.id,
        customerNameSnapshot: item.customerName,
        productNameSnapshot: item.productName,
        specificationSnapshot: item.specification,
        createdById: actor.id,
        createdByName: actor.displayName,
        updatedById: actor.id,
        updatedByName: actor.displayName,
      },
      include: { drawingLibraryItem: { select: { id: true, specification: true } } },
    });
    const entryIds: string[] = [];
    const connectorParameterIds: string[] = [];

    try {
      const [materialEntry, strippingEntry, processTimeEntry, emptyEntry] = await Promise.all([
        prisma.sampleDataEntry.create({
          data: {
            taskId: task.id,
            kind: 'MATERIAL',
            label: '波纹管',
            payload: { lengthMm: 320, model: 'BWG-10' },
            reviewStatus: 'PENDING',
          },
        }),
        prisma.sampleDataEntry.create({
          data: {
            taskId: task.id,
            kind: 'STRIPPING',
            label: 'A端',
            payload: { model: 'HV-01', outerPeelMm: '18', innerPeelMm: '8' },
            reviewStatus: 'PENDING',
          },
        }),
        prisma.sampleDataEntry.create({
          data: {
            taskId: task.id,
            kind: 'PROCESS_TIME',
            label: '裁线',
            payload: { processDefinitionId: processDefinition.id, recommendedSeconds: 12.5 },
            reviewStatus: 'PENDING',
          },
        }),
        prisma.sampleDataEntry.create({
          data: {
            taskId: task.id,
            kind: 'NOTICE',
            payload: {},
            reviewStatus: 'PENDING',
          },
        }),
      ]);
      entryIds.push(materialEntry.id, strippingEntry.id, processTimeEntry.id, emptyEntry.id);

      const actorSnapshot = { id: actor.id, name: actor.displayName || actor.username };
      await assert.rejects(
        prisma.$transaction(
          tx => publishSampleEntry(tx, task, emptyEntry, actorSnapshot, 'APPEND'),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
        /没有可发布内容/,
      );

      const results = await prisma.$transaction(async tx => {
        const material = await publishSampleEntry(tx, task, materialEntry, actorSnapshot, 'APPEND');
        const stripping = await publishSampleEntry(tx, task, strippingEntry, actorSnapshot, 'REPLACE_MATCHING');
        const processTime = await publishSampleEntry(tx, task, processTimeEntry, actorSnapshot, 'APPEND');
        const emptyRecordOnly = await publishSampleEntry(tx, task, emptyEntry, actorSnapshot, 'RECORD_ONLY');
        return { material, stripping, processTime, emptyRecordOnly };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      assert.equal(results.material.reviewStatus, 'PUBLISHED');
      assert.equal(results.stripping.reviewStatus, 'PUBLISHED');
      assert.equal(results.processTime.reviewStatus, 'APPROVED');
      assert.equal(results.processTime.entityType, 'product_time_draft');
      assert.equal(results.emptyRecordOnly.reviewStatus, 'APPROVED');
      assert.equal(results.emptyRecordOnly.entityId, null);

      const [materialRecord, connectorBinding, draft, workOrders, completions, laborClaims] = await Promise.all([
        prisma.productDataRecord.findUnique({ where: { sourceSampleEntryId: materialEntry.id } }),
        prisma.productConnectorParameterBinding.findUnique({
          where: { sourceSampleEntryId: strippingEntry.id },
          include: { connectorParameter: true },
        }),
        prisma.productTimeProfile.findFirst({
          where: { drawingLibraryItemId: item.id, status: 'draft' },
          include: { entries: true },
        }),
        prisma.workOrder.count({ where: { drawingLibraryItemId: item.id } }),
        prisma.processCompletion.count({ where: { route: { workOrder: { drawingLibraryItemId: item.id } } } }),
        prisma.processLaborClaim.count({ where: { pool: { workOrder: { drawingLibraryItemId: item.id } } } }),
      ]);

      assert.equal(materialRecord?.kind, 'MATERIAL');
      assert.equal(connectorBinding?.positionLabel, 'A端');
      assert.equal(connectorBinding?.connectorParameter.outerPeelMm, '18');
      assert.equal(draft?.status, 'draft');
      assert.equal(draft?.entries.some(entry => entry.processDefinitionId === processDefinition.id), true);
      assert.equal(workOrders, 0);
      assert.equal(completions, 0);
      assert.equal(laborClaims, 0);

      if (connectorBinding) connectorParameterIds.push(connectorBinding.connectorParameterId);
    } finally {
      await prisma.$transaction(async tx => {
        await tx.productConnectorParameterBinding.deleteMany({ where: { drawingLibraryItemId: item.id } });
        if (connectorParameterIds.length) {
          await tx.connectorParameter.deleteMany({ where: { id: { in: connectorParameterIds } } });
        }
        await tx.productDataRecord.deleteMany({ where: { drawingLibraryItemId: item.id } });
        const profiles = await tx.productTimeProfile.findMany({
          where: { drawingLibraryItemId: item.id },
          select: { id: true },
        });
        if (profiles.length) {
          await tx.productProcessTimeEntry.deleteMany({ where: { profileId: { in: profiles.map(profile => profile.id) } } });
          await tx.productTimeProfile.deleteMany({ where: { id: { in: profiles.map(profile => profile.id) } } });
        }
        await tx.sampleDataEntry.deleteMany({ where: { taskId: task.id } });
        await tx.sampleTask.delete({ where: { id: task.id } });
        await tx.processDefinition.delete({ where: { id: processDefinition.id } });
        await tx.drawingLibraryItem.delete({ where: { id: item.id } });
        await tx.user.delete({ where: { id: actor.id } });
      });
    }
  },
);
