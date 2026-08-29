import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProcessRouteChangeStatus } from '@prisma/client';
import { dispatchProcessRouteChangeOutbox } from '../lib/process-route-change-notifications';
import { prisma } from '../lib/prisma';
import { createSystemNotification, setNotificationCompletedState } from '../lib/system-notifications';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

type ChangeFixture = {
  changeId: string;
  changeRequestId: string;
  routeId: string;
  workOrderId: string;
};

async function createChangeFixture(
  prefix: string,
  status: ProcessRouteChangeStatus,
  userId: string,
): Promise<ChangeFixture> {
  const workOrder = await prisma.workOrder.create({
    data: {
      code: `${prefix}-WO`,
      productName: `${prefix} product`,
      stage: 'frontend',
      processRoute: {
        create: {
          templateName: `${prefix} route`,
          templateVersion: 1,
          status: 'in_progress',
          routeSource: 'notification_lifecycle_test',
        },
      },
    },
    include: { processRoute: true },
  });
  const changeRequest = await prisma.changeRequest.create({
    data: {
      title: `${prefix} change`,
      type: 'process',
      status: status === ProcessRouteChangeStatus.ACTIVE || status === ProcessRouteChangeStatus.REJECTED
        ? 'closed'
        : 'implementing',
      workOrderId: workOrder.id,
      requesterId: userId,
      ownerId: userId,
    },
  });
  const change = await prisma.processRouteChange.create({
    data: {
      changeRequestId: changeRequest.id,
      workOrderId: workOrder.id,
      routeId: workOrder.processRoute!.id,
      status,
      baseRouteVersion: 0,
      routeSnapshot: {},
      createdById: userId,
      updatedById: userId,
    },
  });
  return {
    changeId: change.id,
    changeRequestId: changeRequest.id,
    routeId: workOrder.processRoute!.id,
    workOrderId: workOrder.id,
  };
}

async function deleteChangeFixture(fixture: ChangeFixture): Promise<void> {
  await prisma.systemNotification.deleteMany({
    where: { sourceType: 'process_route_change', sourceId: fixture.changeId },
  });
  await prisma.processRouteChange.delete({ where: { id: fixture.changeId } });
  await prisma.changeRequest.delete({ where: { id: fixture.changeRequestId } });
  await prisma.workOrder.delete({ where: { id: fixture.workOrderId } });
}

async function createOutbox(input: {
  fixture: ChangeFixture;
  eventType: string;
  key: string;
  createdAt: Date;
  availableAt?: Date;
}) {
  return prisma.processRouteChangeOutbox.create({
    data: {
      changeId: input.fixture.changeId,
      eventType: input.eventType,
      dedupeKey: input.key,
      createdAt: input.createdAt,
      availableAt: input.availableAt || input.createdAt,
      payload: {
        changeId: input.fixture.changeId,
        workOrderId: input.fixture.workOrderId,
      },
    },
  });
}

async function recipient(notificationKey: string, userId: string) {
  return prisma.systemNotificationRecipient.findFirstOrThrow({
    where: { userId, notification: { dedupeKey: `route-change:${notificationKey}` } },
    include: { notification: true },
  });
}

test('late submitted delivery cannot reopen approved work, terminal source overrides manual completion, and replay is idempotent', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `process-outbox-order-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      username: prefix,
      passwordHash: 'integration-test-only',
      displayName: '工艺通知顺序测试管理员',
      laborRole: 'ADMIN',
    },
  });
  const fixture = await createChangeFixture(prefix, ProcessRouteChangeStatus.APPROVED, user.id);
  const base = new Date(Date.now() - 60_000);
  const submitted = await createOutbox({
    fixture,
    eventType: 'PROCESS_ROUTE_CHANGE_SUBMITTED',
    key: `${prefix}:submitted`,
    createdAt: base,
    availableAt: new Date(Date.now() + 60_000),
  });
  const approved = await createOutbox({
    fixture,
    eventType: 'PROCESS_ROUTE_CHANGE_APPROVED',
    key: `${prefix}:approved`,
    createdAt: new Date(base.getTime() + 10_000),
    availableAt: new Date(),
  });

  try {
    const approvedDispatch = await dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 });
    assert.equal(approvedDispatch.inAppDelivered, 1);
    assert.equal((await recipient(approved.dedupeKey, user.id)).completedAt, null);

    await prisma.processRouteChangeOutbox.update({
      where: { id: submitted.id }, data: { availableAt: new Date() },
    });
    const lateDispatch = await dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 });
    assert.equal(lateDispatch.inAppDelivered, 1);
    const lateSubmitted = await recipient(submitted.dedupeKey, user.id);
    assert.ok(lateSubmitted.completedAt);
    assert.equal(lateSubmitted.completionKind, 'SOURCE_RESOLVED');
    assert.equal((await recipient(approved.dedupeKey, user.id)).completedAt, null);

    const approvedNotification = await recipient(approved.dedupeKey, user.id);
    assert.equal((await setNotificationCompletedState(user.id, approvedNotification.notificationId, true)).status, 'updated');
    assert.equal((await recipient(approved.dedupeKey, user.id)).completionKind, 'MANUAL');

    await prisma.processRouteChange.update({
      where: { id: fixture.changeId }, data: { status: ProcessRouteChangeStatus.ACTIVE },
    });
    const activated = await createOutbox({
      fixture,
      eventType: 'PROCESS_ROUTE_CHANGE_ACTIVATED',
      key: `${prefix}:activated`,
      createdAt: new Date(base.getTime() + 20_000),
      availableAt: new Date(),
    });
    await dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 });
    const sourceResolvedApproved = await recipient(approved.dedupeKey, user.id);
    const sourceResolvedActivated = await recipient(activated.dedupeKey, user.id);
    assert.equal(sourceResolvedApproved.completionKind, 'SOURCE_RESOLVED');
    assert.equal(sourceResolvedActivated.completionKind, 'SOURCE_RESOLVED');
    assert.deepEqual(
      await setNotificationCompletedState(user.id, sourceResolvedApproved.notificationId, false),
      { status: 'not_restorable' },
    );

    const legacyManual = await prisma.$transaction(async tx => createSystemNotification(tx, {
      eventType: 'PROCESS_ROUTE_CHANGE_APPROVED',
      dedupeKey: `${prefix}:legacy-manual-after-terminal`,
      category: 'APPROVAL',
      title: '模拟终态前遗留的手动完成',
      sourceType: 'process_route_change',
      sourceId: fixture.changeId,
      recipientUserIds: [user.id],
    }));
    const legacyManualAt = new Date();
    await prisma.systemNotificationRecipient.update({
      where: {
        notificationId_userId: { notificationId: legacyManual!.notificationId, userId: user.id },
      },
      data: {
        completedAt: legacyManualAt,
        completionKind: 'MANUAL',
        completionReason: '终态前手工处理',
        readAt: legacyManualAt,
      },
    });
    assert.deepEqual(
      await setNotificationCompletedState(user.id, legacyManual!.notificationId, false),
      { status: 'not_restorable' },
    );
    assert.equal((await prisma.systemNotificationRecipient.findUniqueOrThrow({
      where: {
        notificationId_userId: { notificationId: legacyManual!.notificationId, userId: user.id },
      },
    })).completionKind, 'SOURCE_RESOLVED');

    const firstActivatedAt = sourceResolvedActivated.completedAt;
    await prisma.processRouteChangeOutbox.update({
      where: { id: activated.id },
      data: { status: 'PENDING', attempts: 0, processedAt: null, availableAt: new Date() },
    });
    await dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 });
    const replayedActivated = await recipient(activated.dedupeKey, user.id);
    assert.equal(replayedActivated.completedAt?.toISOString(), firstActivatedAt?.toISOString());
    assert.equal(await prisma.systemNotification.count({
      where: { dedupeKey: `route-change:${activated.dedupeKey}` },
    }), 1);
  } finally {
    await deleteChangeFixture(fixture);
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('manual restore is allowed only for the stage proven current by status and latest core outbox', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `process-restore-race-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      username: prefix,
      passwordHash: 'integration-test-only',
      displayName: '工艺通知恢复竞态测试用户',
    },
  });
  const fixtures: ChangeFixture[] = [];
  const base = new Date(Date.now() - 120_000);

  async function manuallyCompleteCurrentStage(
    fixture: ChangeFixture,
    eventType: string,
    suffix: string,
    createdAt: Date,
  ) {
    const outbox = await createOutbox({
      fixture,
      eventType,
      key: `${prefix}:${suffix}`,
      createdAt,
      availableAt: new Date(Date.now() + 3600_000),
    });
    const notification = await prisma.$transaction(async tx => createSystemNotification(tx, {
      eventType,
      dedupeKey: `route-change:${outbox.dedupeKey}`,
      category: 'APPROVAL',
      title: eventType,
      sourceType: 'process_route_change',
      sourceId: fixture.changeId,
      recipientUserIds: [user.id],
    }));
    assert.ok(notification);
    const completed = await setNotificationCompletedState(user.id, notification!.notificationId, true);
    assert.equal(completed.status, 'updated');
    if (completed.status === 'updated') assert.equal(completed.completionKind, 'MANUAL');
    return notification!.notificationId;
  }

  async function assertRestoreRejectedAndResolved(notificationId: string) {
    assert.deepEqual(
      await setNotificationCompletedState(user.id, notificationId, false),
      { status: 'not_restorable' },
    );
    const row = await prisma.systemNotificationRecipient.findUniqueOrThrow({
      where: { notificationId_userId: { notificationId, userId: user.id } },
    });
    assert.equal(row.completionKind, 'SOURCE_RESOLVED');
    assert.match(row.completionReason || '', /当前状态|业务源/);
  }

  try {
    // A submitted notification was current when manually completed. Once a
    // later approved outbox exists, status APPROVED proves it is now stale.
    const approvedFixture = await createChangeFixture(
      `${prefix}-approved`, ProcessRouteChangeStatus.SUBMITTED, user.id,
    );
    fixtures.push(approvedFixture);
    const oldSubmittedForApproved = await manuallyCompleteCurrentStage(
      approvedFixture, 'PROCESS_ROUTE_CHANGE_SUBMITTED', 'submitted-before-approved', base,
    );
    await prisma.processRouteChange.update({
      where: { id: approvedFixture.changeId },
      data: { status: ProcessRouteChangeStatus.APPROVED },
    });
    await createOutbox({
      fixture: approvedFixture,
      eventType: 'PROCESS_ROUTE_CHANGE_APPROVED',
      key: `${prefix}:approved-current`,
      createdAt: new Date(base.getTime() + 10_000),
    });
    await assertRestoreRejectedAndResolved(oldSubmittedForApproved);

    // FAILED is recoverable through the latest approved action; it must not
    // make an older submitted notification restorable.
    const failedFixture = await createChangeFixture(
      `${prefix}-failed`, ProcessRouteChangeStatus.SUBMITTED, user.id,
    );
    fixtures.push(failedFixture);
    const oldSubmittedForFailed = await manuallyCompleteCurrentStage(
      failedFixture, 'PROCESS_ROUTE_CHANGE_SUBMITTED', 'submitted-before-failed', base,
    );
    await prisma.processRouteChange.update({
      where: { id: failedFixture.changeId },
      data: { status: ProcessRouteChangeStatus.FAILED },
    });
    await createOutbox({
      fixture: failedFixture,
      eventType: 'PROCESS_ROUTE_CHANGE_APPROVED',
      key: `${prefix}:approved-before-failed`,
      createdAt: new Date(base.getTime() + 10_000),
    });
    await assertRestoreRejectedAndResolved(oldSubmittedForFailed);

    // A reevaluation returns the source to SUBMITTED. The older approved
    // notification cannot be restored even though it was once current.
    const reevaluatedFixture = await createChangeFixture(
      `${prefix}-reevaluated`, ProcessRouteChangeStatus.APPROVED, user.id,
    );
    fixtures.push(reevaluatedFixture);
    const oldApproved = await manuallyCompleteCurrentStage(
      reevaluatedFixture, 'PROCESS_ROUTE_CHANGE_APPROVED', 'approved-before-reevaluation', base,
    );
    await prisma.processRouteChange.update({
      where: { id: reevaluatedFixture.changeId },
      data: { status: ProcessRouteChangeStatus.SUBMITTED },
    });
    await createOutbox({
      fixture: reevaluatedFixture,
      eventType: 'PROCESS_ROUTE_CHANGE_REEVALUATED',
      key: `${prefix}:reevaluated-current`,
      createdAt: new Date(base.getTime() + 10_000),
    });
    await assertRestoreRejectedAndResolved(oldApproved);

    // The latest approved notification remains the current actionable stage
    // while activation is FAILED, so a manual completion may still be restored.
    const currentFixture = await createChangeFixture(
      `${prefix}-current`, ProcessRouteChangeStatus.FAILED, user.id,
    );
    fixtures.push(currentFixture);
    const currentApproved = await manuallyCompleteCurrentStage(
      currentFixture, 'PROCESS_ROUTE_CHANGE_APPROVED', 'approved-current-failed', base,
    );
    assert.deepEqual(await setNotificationCompletedState(user.id, currentApproved, false), {
      status: 'updated', completedAt: null, completionKind: null, canRestore: false,
    });
    assert.equal((await prisma.systemNotificationRecipient.findUniqueOrThrow({
      where: { notificationId_userId: { notificationId: currentApproved, userId: user.id } },
    })).completedAt, null);
  } finally {
    for (const fixture of fixtures.reverse()) await deleteChangeFixture(fixture);
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('concurrent outbox workers leave no older core stage pending after activation', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `process-outbox-concurrent-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      username: prefix,
      passwordHash: 'integration-test-only',
      displayName: '工艺通知并发测试管理员',
      laborRole: 'ADMIN',
    },
  });
  const fixture = await createChangeFixture(prefix, ProcessRouteChangeStatus.ACTIVE, user.id);
  const base = new Date(Date.now() - 30_000);
  const approved = await createOutbox({
    fixture, eventType: 'PROCESS_ROUTE_CHANGE_APPROVED', key: `${prefix}:approved`, createdAt: base,
  });
  const activated = await createOutbox({
    fixture, eventType: 'PROCESS_ROUTE_CHANGE_ACTIVATED', key: `${prefix}:activated`,
    createdAt: new Date(base.getTime() + 10_000),
  });
  try {
    await Promise.all([
      dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 }),
      dispatchProcessRouteChangeOutbox({ changeId: fixture.changeId, limit: 5 }),
    ]);
    const rows = await Promise.all([
      recipient(approved.dedupeKey, user.id),
      recipient(activated.dedupeKey, user.id),
    ]);
    assert.ok(rows.every(row => row.completedAt && row.completionKind === 'SOURCE_RESOLVED'));
    assert.equal(await prisma.systemNotificationRecipient.count({
      where: {
        userId: user.id,
        completedAt: null,
        notification: { sourceType: 'process_route_change', sourceId: fixture.changeId },
      },
    }), 0);
  } finally {
    await deleteChangeFixture(fixture);
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('completion migration fixture preserves failed and unknown rows and archives only durable outbox evidence', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `process-migration-fixture-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { username: prefix, passwordHash: 'integration-test-only', displayName: '迁移测试用户' },
  });
  const fixtures: ChangeFixture[] = [];
  const keys: Record<string, string> = {};
  const base = new Date(Date.now() - 120_000);

  async function addNotification(fixture: ChangeFixture, eventType: string, suffix: string, at: Date) {
    const outbox = await createOutbox({
      fixture, eventType, key: `${prefix}:${suffix}`, createdAt: at, availableAt: new Date(Date.now() + 3600_000),
    });
    await prisma.$transaction(async tx => {
      await createSystemNotification(tx, {
        eventType,
        dedupeKey: `route-change:${outbox.dedupeKey}`,
        category: 'APPROVAL',
        title: eventType,
        sourceType: 'process_route_change',
        sourceId: fixture.changeId,
        recipientUserIds: [user.id],
      });
    });
    keys[suffix] = outbox.dedupeKey;
  }

  try {
    const failed = await createChangeFixture(`${prefix}-failed`, ProcessRouteChangeStatus.FAILED, user.id);
    const advanced = await createChangeFixture(`${prefix}-advanced`, ProcessRouteChangeStatus.APPROVED, user.id);
    const supplement = await createChangeFixture(`${prefix}-supplement`, ProcessRouteChangeStatus.ACTIVE, user.id);
    fixtures.push(failed, advanced, supplement);

    await addNotification(failed, 'PROCESS_ROUTE_CHANGE_SUBMITTED', 'failed-submitted', base);
    await addNotification(failed, 'PROCESS_ROUTE_CHANGE_FAILED', 'failed-unknown', new Date(base.getTime() + 10_000));
    await addNotification(advanced, 'PROCESS_ROUTE_CHANGE_SUBMITTED', 'advanced-submitted', base);
    await addNotification(advanced, 'PROCESS_ROUTE_CHANGE_APPROVED', 'advanced-approved', new Date(base.getTime() + 10_000));
    await addNotification(supplement, 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED', 'supplement-report-a', base);
    await addNotification(supplement, 'PROCESS_SUPPLEMENT_UNKNOWN', 'supplement-unknown-b', new Date(base.getTime() + 10_000));

    const migration = readFileSync(new URL(
      '../prisma/migrations/202608290005_notification_completion_state/migration.sql',
      import.meta.url,
    ), 'utf8');
    const backfill = migration.slice(migration.indexOf('WITH "evidenced_process_notifications"'));
    assert.ok(backfill.startsWith('WITH '));
    await prisma.$executeRawUnsafe(backfill);

    const results = Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([name, key]) => {
      const row = await recipient(key, user.id);
      return [name, row] as const;
    })));
    assert.equal(results['failed-submitted'].completedAt, null);
    assert.equal(results['failed-unknown'].completedAt, null);
    assert.equal(results['advanced-submitted'].completionKind, 'SYSTEM_RECONCILED');
    assert.equal(results['advanced-approved'].completedAt, null);
    assert.equal(results['supplement-report-a'].completionKind, 'SYSTEM_RECONCILED');
    assert.equal(results['supplement-unknown-b'].completedAt, null);
  } finally {
    for (const fixture of fixtures.reverse()) await deleteChangeFixture(fixture);
    await prisma.user.delete({ where: { id: user.id } });
  }
});
