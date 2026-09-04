import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { publishSampleEntry } from '../lib/sample-team-publish';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const legacyBackfillSql = readFileSync(
  resolve(import.meta.dirname, '../prisma/migrations/202609020002_sample_capture_legacy_backfill/migration.sql'),
  'utf8',
);

test(
  'legacy submitted sample rows receive one idempotent active submission ledger',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-SAMPLE-LEGACY-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} reviewer`,
      },
    });
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'legacy-integration-test',
        productName: 'legacy sample product',
        specification: `${prefix}-PRODUCT`,
        libraryKey: `${prefix}-LIBRARY`,
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
        status: 'SUBMITTED',
        submittedAt: new Date(),
        createdById: actor.id,
        createdByName: actor.displayName,
        updatedById: actor.id,
        updatedByName: actor.displayName,
      },
    });

    try {
      const [entry, photo] = await Promise.all([
        prisma.sampleDataEntry.create({
          data: {
            taskId: task.id,
            kind: 'PROCESS_TIME',
            label: '旧版候选工序',
            payload: { processName: '旧版候选工序', recommendedSeconds: 10 },
            reviewStatus: 'PENDING',
          },
        }),
        prisma.samplePhoto.create({
          data: {
            taskId: task.id,
            category: 'PROCESS_TIME',
            originalName: 'legacy.png',
            mimeType: 'image/png',
            size: 8,
            objectKey: `sample-legacy/${prefix}.png`,
            sha256: '0'.repeat(64),
            reviewStatus: 'PENDING',
          },
        }),
      ]);

      await prisma.$executeRawUnsafe(legacyBackfillSql);
      await prisma.$executeRawUnsafe(legacyBackfillSql);

      const [persisted, submissions, persistedEntry, persistedPhoto] = await Promise.all([
        prisma.sampleTask.findUnique({ where: { id: task.id }, include: { activeSubmission: true } }),
        prisma.sampleSubmission.findMany({ where: { taskId: task.id } }),
        prisma.sampleDataEntry.findUnique({ where: { id: entry.id } }),
        prisma.samplePhoto.findUnique({ where: { id: photo.id } }),
      ]);
      assert.equal(persisted?.status, 'SUBMITTED');
      assert.equal(persisted?.submissionRevision, 1);
      assert.equal(persisted?.activeSubmission?.status, 'PENDING');
      assert.equal(persistedEntry?.submissionRevision, 1);
      assert.equal(persistedPhoto?.submissionRevision, 1);
      assert.equal(submissions.length, 1);
      assert.equal((submissions[0]?.snapshot as Record<string, unknown>).legacyMigration, true);
    } finally {
      await prisma.sampleTask.delete({ where: { id: task.id } });
      await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);

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
      const section = await prisma.sampleDraftSection.create({
        data: {
          taskId: task.id,
          kind: 'PROCESS_TIME',
          payload: { rows: [{ rowId: 'row-1', position: 0, processDefinitionId: null, processName: '候选裁线', processOrigin: 'PROPOSED', measuredMilliseconds: 10000 }] },
          uiState: { lastEditedRowId: 'row-1' },
          lastMutationId: `${prefix}-SECTION-MUTATION`,
          lastRequestHash: `${prefix}-SECTION-HASH`,
        },
      });
      const submission = await prisma.sampleSubmission.create({
        data: {
          taskId: task.id,
          revision: 1,
          mutationId: `${prefix}-SUBMISSION-MUTATION`,
          requestHash: `${prefix}-SUBMISSION-HASH`,
          snapshot: { schemaVersion: 1, sectionId: section.id },
          submittedById: actor.id,
          submittedByName: actor.displayName,
        },
      });
      await prisma.sampleTask.update({
        where: { id: task.id },
        data: { submissionRevision: 1, activeSubmissionId: submission.id, status: 'SUBMITTED' },
      });
      const persisted = await prisma.sampleTask.findUnique({
        where: { id: task.id },
        include: { draftSections: true, activeSubmission: true },
      });
      assert.equal(persisted?.draftSections[0]?.revision, 1);
      assert.equal(persisted?.activeSubmission?.id, submission.id);
      await prisma.sampleSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'WITHDRAWN',
          withdrawalMutationId: `${prefix}-WITHDRAW-MUTATION`,
          withdrawalRequestHash: `${prefix}-WITHDRAW-HASH`,
          withdrawnAt: new Date(),
        },
      });
      await prisma.sampleTask.update({
        where: { id: task.id },
        data: { activeSubmissionId: null, status: 'IN_PROGRESS' },
      });

      const [materialEntry, candidateProcessEntry, strippingEntry, processTimeEntry, emptyEntry] = await Promise.all([
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
            kind: 'PROCESS_TIME',
            label: '候选裁线',
            payload: { processDefinitionId: null, processName: '候选裁线', processOrigin: 'PROPOSED', recommendedSeconds: 10 },
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
      entryIds.push(materialEntry.id, strippingEntry.id, processTimeEntry.id, candidateProcessEntry.id, emptyEntry.id);

      const actorSnapshot = { id: actor.id, name: actor.displayName || actor.username };
      await assert.rejects(
        prisma.$transaction(
          tx => publishSampleEntry(tx, task, emptyEntry, actorSnapshot, 'APPEND'),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
        /没有可发布内容/,
      );
      await assert.rejects(
        prisma.$transaction(
          tx => publishSampleEntry(tx, task, candidateProcessEntry, actorSnapshot, 'APPEND'),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
        /尚未关联工序库/,
      );

      const results = await prisma.$transaction(async tx => {
        const material = await publishSampleEntry(tx, task, materialEntry, actorSnapshot, 'APPEND');
        const stripping = await publishSampleEntry(tx, task, strippingEntry, actorSnapshot, 'REPLACE_MATCHING');
        const processTime = await publishSampleEntry(tx, task, processTimeEntry, actorSnapshot, 'APPEND');
        const emptyRecordOnly = await publishSampleEntry(tx, task, emptyEntry, actorSnapshot, 'RECORD_ONLY');
        const mappedCandidate = await publishSampleEntry(tx, task, {
          ...candidateProcessEntry,
          payload: { processDefinitionId: processDefinition.id, processName: processDefinition.name, processOrigin: 'MASTER', recommendedSeconds: 10 },
        }, actorSnapshot, 'APPEND');
        return { material, stripping, processTime, mappedCandidate, emptyRecordOnly };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      assert.equal(results.material.reviewStatus, 'PUBLISHED');
      assert.equal(results.stripping.reviewStatus, 'PUBLISHED');
      assert.equal(results.processTime.reviewStatus, 'APPROVED');
      assert.equal(results.processTime.entityType, 'product_time_draft');
      assert.equal(results.mappedCandidate.entityType, 'product_time_draft');
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

      const replacementEntry = await prisma.sampleDataEntry.create({
        data: {
          taskId: task.id,
          kind: 'STRIPPING',
          label: 'A端',
          payload: { model: 'HV-01', outerPeelMm: '20', innerPeelMm: '8', positionLabel: 'A端' },
          reviewStatus: 'PENDING',
        },
      });
      entryIds.push(replacementEntry.id);
      await assert.rejects(
        prisma.$transaction(tx => publishSampleEntry(tx, task, replacementEntry, actorSnapshot, 'APPEND')),
        /已经存在不同的当前剥皮参数/,
      );
      const replacement = await prisma.$transaction(tx => publishSampleEntry(tx, task, replacementEntry, actorSnapshot, 'REPLACE_MATCHING'));
      const bindingVersions = await prisma.productConnectorParameterBinding.findMany({
        where: { drawingLibraryItemId: item.id, positionKey: 'a端' },
        include: { connectorParameter: true },
        orderBy: { version: 'asc' },
      });
      assert.equal(replacement.reviewStatus, 'PUBLISHED');
      assert.equal(bindingVersions.length, 2);
      assert.equal(bindingVersions[0]?.isCurrent, false);
      assert.equal(bindingVersions[0]?.status, 'SUPERSEDED');
      assert.equal(bindingVersions[1]?.isCurrent, true);
      assert.equal(bindingVersions[1]?.connectorParameter.outerPeelMm, '20');

      if (connectorBinding) connectorParameterIds.push(connectorBinding.connectorParameterId);
    } finally {
      await prisma.$transaction(async tx => {
        const boundParameters = await tx.productConnectorParameterBinding.findMany({ where: { drawingLibraryItemId: item.id }, select: { connectorParameterId: true } });
        await tx.samplePublicationLink.deleteMany({ where: { sampleTaskId: task.id } });
        await tx.productConnectorParameterBinding.deleteMany({ where: { drawingLibraryItemId: item.id } });
        const parameterIds = [...new Set([...connectorParameterIds, ...boundParameters.map(binding => binding.connectorParameterId)])];
        if (parameterIds.length) {
          await tx.connectorParameter.deleteMany({ where: { id: { in: parameterIds } } });
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
