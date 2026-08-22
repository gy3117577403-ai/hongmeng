import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  previewProductTimeDeployment,
  ProductTimeDeploymentError,
  publishProductTimeDeployment,
} from '../lib/product-time-deployment-service';
import { syncProductTimeDraftToPublished } from '../lib/product-time-draft-sync-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'stale draft is blocked, can merge the latest published process, and then publishes monotonically',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-DRAFT-SYNC-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} publisher`,
      },
    });
    const [definitionA, definitionB, definitionC] = await Promise.all([
      prisma.processDefinition.create({ data: { code: `${prefix}-A`, name: '工序 A', stageGroup: 'frontend', sortOrder: 1 } }),
      prisma.processDefinition.create({ data: { code: `${prefix}-B`, name: '员工新增工序 B', stageGroup: 'backend', sortOrder: 2 } }),
      prisma.processDefinition.create({ data: { code: `${prefix}-C`, name: '工序 C', stageGroup: 'finish', sortOrder: 3 } }),
    ]);
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        specification: prefix,
        productName: 'stale draft sync test',
        libraryKey: `${prefix}-LIBRARY`,
      },
    });
    const original = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 1,
        revision: 0,
        status: 'published',
        publishedAt: new Date(Date.now() - 60_000),
        createdById: actor.id,
        updatedById: actor.id,
        publishedById: actor.id,
        entries: {
          create: [
            {
              processDefinitionId: definitionA.id,
              occurrenceKey: 'operation-A',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 1_000,
              unitLabel: '套',
            },
            {
              processDefinitionId: definitionC.id,
              occurrenceKey: 'operation-C',
              position: 2,
              sequenceGroup: 2,
              timeBasis: 'per_unit',
              unitMilliseconds: 2_000,
              unitLabel: '套',
            },
          ],
        },
      },
    });
    const draft = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 2,
        revision: 0,
        status: 'draft',
        createdById: actor.id,
        updatedById: actor.id,
        entries: {
          create: [
            {
              processDefinitionId: definitionA.id,
              occurrenceKey: 'operation-A',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 1_500,
              unitLabel: '套',
            },
            {
              processDefinitionId: definitionC.id,
              occurrenceKey: 'operation-C',
              position: 2,
              sequenceGroup: 2,
              timeBasis: 'per_unit',
              unitMilliseconds: 2_000,
              unitLabel: '套',
            },
          ],
        },
      },
    });
    await prisma.productTimeProfile.update({
      where: { id: original.id },
      data: { status: 'archived' },
    });
    const employeePublished = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 3,
        revision: 0,
        status: 'published',
        sourceType: 'process_route_change',
        publishedAt: new Date(),
        createdById: actor.id,
        updatedById: actor.id,
        publishedById: actor.id,
        entries: {
          create: [
            {
              processDefinitionId: definitionA.id,
              occurrenceKey: 'operation-A',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 1_000,
              unitLabel: '套',
            },
            {
              processDefinitionId: definitionB.id,
              occurrenceKey: 'employee-operation-B',
              position: 2,
              sequenceGroup: 2,
              timeBasis: 'per_unit',
              unitMilliseconds: 800,
              unitLabel: '套',
            },
            {
              processDefinitionId: definitionC.id,
              occurrenceKey: 'operation-C',
              position: 3,
              sequenceGroup: 3,
              timeBasis: 'per_unit',
              unitMilliseconds: 3_000,
              unitLabel: '套',
            },
          ],
        },
      },
    });

    try {
      await assert.rejects(
        previewProductTimeDeployment(item.id),
        error => error instanceof ProductTimeDeploymentError
          && error.code === 'PRODUCT_TIME_DRAFT_STALE'
          && /V2/.test(error.message)
          && /V3/.test(error.message),
      );

      const synced = await syncProductTimeDraftToPublished({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
      });
      assert.equal(synced.profile.id, draft.id);
      assert.equal(synced.summary.baseVersion, 1);
      assert.equal(synced.summary.fromDraftVersion, 2);
      assert.equal(synced.summary.publishedVersion, 3);
      assert.equal(synced.summary.toDraftVersion, 4);
      assert.equal(synced.summary.addedFromPublished, 1);
      assert.equal(synced.summary.updatedFromPublished, 1);
      assert.equal(synced.summary.conflicts.length, 0);
      assert.deepEqual(synced.profile.entries.map(entry => entry.occurrenceKey), [
        'operation-A',
        'employee-operation-B',
        'operation-C',
      ]);
      assert.equal(
        synced.profile.entries.find(entry => entry.occurrenceKey === 'operation-A')?.unitMilliseconds,
        1_500,
      );
      assert.equal(
        synced.profile.entries.find(entry => entry.occurrenceKey === 'operation-C')?.unitMilliseconds,
        3_000,
      );

      const preview = await previewProductTimeDeployment(item.id);
      assert.equal(preview.fromVersion, 3);
      assert.equal(preview.toVersion, 4);
      assert.equal(preview.canPublish, true);
      const result = await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: synced.profile.revision,
        previewToken: preview.previewToken,
      });
      assert.equal(result.profileId, draft.id);
      assert.equal(result.deployment.profileVersion, 4);
      assert.equal(result.deployment.status, 'active');

      const profiles = await prisma.productTimeProfile.findMany({
        where: { drawingLibraryItemId: item.id },
        orderBy: { version: 'asc' },
        select: { id: true, version: true, status: true },
      });
      assert.deepEqual(profiles.map(profile => [profile.version, profile.status]), [
        [1, 'archived'],
        [3, 'archived'],
        [4, 'published'],
      ]);
      assert.equal(profiles.some(profile => profile.id === employeePublished.id && profile.status === 'archived'), true);
    } finally {
      await prisma.productTimeDeployment.deleteMany({ where: { drawingLibraryItemId: item.id } });
      await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
      await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({
        where: { id: { in: [definitionA.id, definitionB.id, definitionC.id] } },
      });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
