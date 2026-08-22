import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  ProductTimeDraftSyncError,
  productTimeDraftRebuildConfirmation,
  rebuildProductTimeDraftFromPublished,
} from '../lib/product-time-draft-sync-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'discard and rebuild keeps the abandoned draft for audit and copies the exact published route',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-DRAFT-REBUILD-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} publisher`,
      },
    });
    const [definitionA, definitionB] = await Promise.all([
      prisma.processDefinition.create({ data: { code: `${prefix}-A`, name: '正式工序 A', stageGroup: 'frontend', sortOrder: 1 } }),
      prisma.processDefinition.create({ data: { code: `${prefix}-B`, name: '正式工序 B', stageGroup: 'backend', sortOrder: 2 } }),
    ]);
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        specification: prefix,
        productName: 'draft rebuild test',
        libraryKey: `${prefix}-LIBRARY`,
      },
    });
    const published = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 3,
        revision: 2,
        status: 'published',
        sourceType: 'process_route_change',
        reportingPolicy: 'strict_sequence',
        remark: '正式版说明必须原样保留',
        publishedAt: new Date(),
        createdById: actor.id,
        updatedById: actor.id,
        publishedById: actor.id,
        entries: {
          create: [
            {
              processDefinitionId: definitionA.id,
              occurrenceKey: 'published-A',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 2_400,
              actionMilliseconds: 800,
              occurrences: 3,
              setupMilliseconds: 500,
              unitLabel: '套',
              reportQuantityBasis: 'action',
              reportUnitLabel: '次',
              countsForEfficiency: false,
              isCritical: true,
              remark: '正式 A',
            },
            {
              processDefinitionId: definitionB.id,
              occurrenceKey: 'published-B',
              position: 2,
              sequenceGroup: 2,
              timeBasis: 'per_batch',
              unitMilliseconds: 5_000,
              occurrences: 1,
              setupMilliseconds: 700,
              unitLabel: '批',
              reportQuantityBasis: 'product',
              reportUnitLabel: '套',
              countsForEfficiency: true,
              isCritical: false,
              remark: '正式 B',
            },
          ],
        },
      },
    });
    const draft = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 4,
        revision: 7,
        status: 'draft',
        sourceType: 'manual',
        reportingPolicy: 'free_sequence',
        remark: '人工草稿说明',
        createdById: actor.id,
        updatedById: actor.id,
        entries: {
          create: [{
            processDefinitionId: definitionA.id,
            occurrenceKey: 'manual-A',
            position: 1,
            sequenceGroup: 1,
            timeBasis: 'per_unit',
            unitMilliseconds: 9_999,
            unitLabel: '套',
            remark: '必须保留在放弃记录里的人工修改',
          }],
        },
      },
    });

    try {
      await assert.rejects(
        rebuildProductTimeDraftFromPublished({
          itemId: item.id,
          actorId: actor.id,
          expectedRevision: draft.revision,
          expectedPublishedVersion: published.version,
          confirmationText: '确认',
        }),
        error => error instanceof ProductTimeDraftSyncError
          && error.code === 'PRODUCT_TIME_DRAFT_REBUILD_CONFIRMATION_REQUIRED',
      );

      const confirmationText = productTimeDraftRebuildConfirmation(draft.version, published.version);
      const rebuilt = await rebuildProductTimeDraftFromPublished({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
        expectedPublishedVersion: published.version,
        confirmationText,
      });
      assert.equal(rebuilt.summary.discardedProfileId, draft.id);
      assert.equal(rebuilt.summary.discardedDraftVersion, 4);
      assert.equal(rebuilt.summary.publishedVersion, 3);
      assert.equal(rebuilt.summary.rebuiltDraftVersion, 5);
      assert.equal(rebuilt.summary.processCount, 2);
      assert.equal(rebuilt.profile.version, 5);
      assert.equal(rebuilt.profile.revision, 0);
      assert.equal(rebuilt.profile.status, 'draft');
      assert.equal(rebuilt.profile.sourceType, 'rebuild_from_published');
      assert.equal(rebuilt.profile.reportingPolicy, 'strict_sequence');
      assert.equal(rebuilt.profile.remark, '正式版说明必须原样保留');
      assert.deepEqual(
        rebuilt.profile.entries.map(entry => ({
          occurrenceKey: entry.occurrenceKey,
          unitMilliseconds: entry.unitMilliseconds,
          actionMilliseconds: entry.actionMilliseconds,
          occurrences: entry.occurrences,
          setupMilliseconds: entry.setupMilliseconds,
          reportQuantityBasis: entry.reportQuantityBasis,
          reportUnitLabel: entry.reportUnitLabel,
          countsForEfficiency: entry.countsForEfficiency,
          isCritical: entry.isCritical,
          remark: entry.remark,
        })),
        [
          {
            occurrenceKey: 'published-A',
            unitMilliseconds: 2_400,
            actionMilliseconds: 800,
            occurrences: 3,
            setupMilliseconds: 500,
            reportQuantityBasis: 'action',
            reportUnitLabel: '次',
            countsForEfficiency: false,
            isCritical: true,
            remark: '正式 A',
          },
          {
            occurrenceKey: 'published-B',
            unitMilliseconds: 5_000,
            actionMilliseconds: null,
            occurrences: 1,
            setupMilliseconds: 700,
            reportQuantityBasis: 'product',
            reportUnitLabel: '套',
            countsForEfficiency: true,
            isCritical: false,
            remark: '正式 B',
          },
        ],
      );

      const profiles = await prisma.productTimeProfile.findMany({
        where: { drawingLibraryItemId: item.id },
        orderBy: { version: 'asc' },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      assert.deepEqual(profiles.map(profile => [profile.version, profile.status]), [
        [3, 'published'],
        [4, 'discarded'],
        [5, 'draft'],
      ]);
      const discarded = profiles.find(profile => profile.id === draft.id);
      assert.equal(discarded?.entries.length, 1);
      assert.equal(discarded?.entries[0]?.unitMilliseconds, 9_999);
      assert.equal(discarded?.entries[0]?.remark, '必须保留在放弃记录里的人工修改');
      assert.equal(profiles.filter(profile => profile.status === 'draft').length, 1);
      assert.equal(profiles.find(profile => profile.id === published.id)?.status, 'published');

      const log = await prisma.operationLog.findFirst({
        where: {
          userId: actor.id,
          action: 'discard_and_rebuild_product_time_draft',
          targetId: rebuilt.profile.id,
        },
      });
      assert.ok(log);

      await assert.rejects(
        rebuildProductTimeDraftFromPublished({
          itemId: item.id,
          actorId: actor.id,
          expectedRevision: draft.revision,
          expectedPublishedVersion: published.version,
          confirmationText,
        }),
        error => error instanceof ProductTimeDraftSyncError
          && ['PRODUCT_TIME_DRAFT_CONFLICT', 'PRODUCT_TIME_DRAFT_REBUILD_CONFIRMATION_REQUIRED'].includes(error.code),
      );
      assert.equal(await prisma.productTimeProfile.count({
        where: { drawingLibraryItemId: item.id, status: 'draft' },
      }), 1);
    } finally {
      await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
      await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({ where: { id: { in: [definitionA.id, definitionB.id] } } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
