import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import { prisma } from '../lib/prisma';
import { reconcileProcessNotificationLifecycle } from '../lib/process-route-change-notifications';
import {
  createSystemNotification,
  loadNotificationInbox,
  markAllNotificationsRead,
  setNotificationCompletedState,
  snoozeNotification,
} from '../lib/system-notifications';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('notification completion is persistent, user-scoped, restorable, and excluded from active summaries', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `notification-lifecycle-${randomUUID().slice(0, 8)}`;
  const access = resolveAccessContext([{
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
  }]);
  const [user, otherUser] = await Promise.all([
    prisma.user.create({
      data: { username: `${prefix}-owner`, passwordHash: 'integration-test-only', displayName: '通知所有人' },
    }),
    prisma.user.create({
      data: { username: `${prefix}-other`, passwordHash: 'integration-test-only', displayName: '其他用户' },
    }),
  ]);

  try {
    const created = await prisma.$transaction(async tx => {
      const active = await createSystemNotification(tx, {
        eventType: 'NOTIFICATION_LIFECYCLE_ACTIVE',
        dedupeKey: `${prefix}:active`,
        category: 'TODO',
        priority: 'URGENT',
        title: '待处理生产异常',
        sourceType: 'production_alert',
        targetRoute: '/production',
        recipientUserIds: [user.id],
      });
      const completed = await createSystemNotification(tx, {
        eventType: 'NOTIFICATION_LIFECYCLE_COMPLETED',
        dedupeKey: `${prefix}:completed`,
        category: 'APPROVAL',
        priority: 'HIGH',
        title: '已完成工艺审批',
        sourceType: 'process_route_change',
        targetRoute: '/workspace/changes',
        recipientUserIds: [user.id],
      });
      const snoozed = await createSystemNotification(tx, {
        eventType: 'NOTIFICATION_LIFECYCLE_SNOOZED',
        dedupeKey: `${prefix}:snoozed`,
        category: 'TODO',
        priority: 'HIGH',
        title: '稍后处理物料提醒',
        sourceType: 'material_follow_up',
        targetRoute: '/warehouse',
        recipientUserIds: [user.id],
      });
      return {
        activeId: active!.notificationId,
        completedId: completed!.notificationId,
        snoozedId: snoozed!.notificationId,
      };
    });

    const manualCompletion = await setNotificationCompletedState(
      user.id,
      created.completedId,
      true,
      '现场事项已经核实完成',
    );
    assert.equal(manualCompletion.status, 'updated');
    if (manualCompletion.status === 'updated') {
      assert.ok(manualCompletion.completedAt);
      assert.equal(manualCompletion.completionKind, 'MANUAL');
      assert.equal(manualCompletion.canRestore, true);
    }
    const repeatedCompletion = await setNotificationCompletedState(
      user.id,
      created.completedId,
      true,
      '重复请求不应改写原始完成证据',
    );
    assert.deepEqual(repeatedCompletion, manualCompletion);
    assert.ok(await snoozeNotification(user.id, created.snoozedId, 60));

    const pending = await loadNotificationInbox(user.id, access, { state: 'pending', limit: 20 });
    assert.deepEqual(pending.notifications.map(item => item.id), [created.activeId]);
    assert.equal(pending.pendingCount, 1);
    assert.equal(pending.completedCount, 1);
    assert.equal(pending.actionableCount, 1);
    assert.equal(pending.urgentCount, 1);
    assert.equal(pending.unreadCount, 1);
    assert.deepEqual(pending.businessCategoryCounts, {
      PRODUCTION: 1,
      QUALITY: 0,
      PROCESS: 0,
      MATERIAL: 0,
      SYSTEM: 0,
    });
    assert.deepEqual(pending.completedBusinessCategoryCounts, {
      PRODUCTION: 0,
      QUALITY: 0,
      PROCESS: 1,
      MATERIAL: 0,
      SYSTEM: 0,
    });

    const completed = await loadNotificationInbox(user.id, access, { state: 'completed', limit: 20 });
    assert.deepEqual(completed.notifications.map(item => item.id), [created.completedId]);
    assert.ok(completed.notifications[0]?.completedAt);
    assert.equal(completed.notifications[0]?.snoozedUntil, null);
    assert.equal(completed.notifications[0]?.completionKind, 'MANUAL');
    assert.equal(completed.notifications[0]?.completionReason, '现场事项已经核实完成');
    assert.equal(completed.notifications[0]?.canRestore, true);
    assert.equal(completed.pendingCount, 1);
    assert.equal(completed.completedCount, 1);
    assert.equal(completed.completedBusinessCategoryCounts.PROCESS, 1);

    assert.equal(await snoozeNotification(user.id, created.completedId, 60), null);
    assert.deepEqual(await setNotificationCompletedState(otherUser.id, created.completedId, false), { status: 'not_found' });
    assert.deepEqual(await setNotificationCompletedState(user.id, created.completedId, false), {
      status: 'updated', completedAt: null, completionKind: null, canRestore: false,
    });
    assert.deepEqual(await setNotificationCompletedState(user.id, created.completedId, false), {
      status: 'updated', completedAt: null, completionKind: null, canRestore: false,
    });

    const restored = await loadNotificationInbox(user.id, access, { state: 'pending', limit: 20 });
    assert.equal(restored.notifications.some(item => item.id === created.completedId), true);
    assert.equal(restored.pendingCount, 2);
    assert.equal(restored.completedCount, 0);
    assert.equal(restored.actionableCount, 2);
    assert.equal(restored.urgentCount, 1);

    assert.equal(await markAllNotificationsRead(user.id), 1);
    const afterReadAll = await loadNotificationInbox(user.id, access, { state: 'pending', limit: 20 });
    assert.equal(afterReadAll.unreadCount, 0);
  } finally {
    await prisma.systemNotification.deleteMany({ where: { dedupeKey: { startsWith: `${prefix}:` } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
  }
});

test('process notification stages close only superseded change or proven supplement-obligation recipients', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `process-notification-lifecycle-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { username: prefix, passwordHash: 'integration-test-only', displayName: '工艺通知接收人' },
  });
  const changeId = `${prefix}-change`;
  const access = resolveAccessContext([{
    profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL',
  }]);

  async function emit(eventType: string, obligationId?: string): Promise<string> {
    return prisma.$transaction(async tx => {
      const created = await createSystemNotification(tx, {
        eventType,
        dedupeKey: `${prefix}:${eventType}:${randomUUID()}`,
        category: 'APPROVAL',
        title: eventType,
        sourceType: 'process_route_change',
        sourceId: changeId,
        metadata: { obligationId: obligationId || null },
        recipientUserIds: [user.id],
      });
      assert.ok(created);
      await reconcileProcessNotificationLifecycle(tx, {
        notificationId: created!.notificationId,
        changeId,
        eventType,
        obligationId,
      });
      return created!.notificationId;
    });
  }

  try {
    const submittedId = await emit('PROCESS_ROUTE_CHANGE_SUBMITTED');
    const manualBeforeSourceAdvance = await setNotificationCompletedState(user.id, submittedId, true);
    assert.equal(manualBeforeSourceAdvance.status, 'updated');
    const approvedId = await emit('PROCESS_ROUTE_CHANGE_APPROVED');
    let recipients = await prisma.systemNotificationRecipient.findMany({
      where: { userId: user.id, notificationId: { in: [submittedId, approvedId] } },
    });
    assert.ok(recipients.find(item => item.notificationId === submittedId)?.completedAt);
    assert.equal(recipients.find(item => item.notificationId === submittedId)?.completionKind, 'SOURCE_RESOLVED');
    assert.equal(recipients.find(item => item.notificationId === approvedId)?.completedAt, null);

    const rejectedId = await emit('PROCESS_ROUTE_CHANGE_REJECTED');
    recipients = await prisma.systemNotificationRecipient.findMany({
      where: { userId: user.id, notificationId: { in: [submittedId, approvedId, rejectedId] } },
    });
    assert.ok(recipients.every(item => item.completedAt));
    assert.ok(recipients.every(item => item.completionKind === 'SOURCE_RESOLVED'));
    assert.ok(recipients.every(item => item.completionReason?.includes('工艺')));
    assert.deepEqual(await setNotificationCompletedState(user.id, rejectedId, false), { status: 'not_restorable' });
    const repeatedTerminalCompletion = await setNotificationCompletedState(user.id, rejectedId, true);
    assert.equal(repeatedTerminalCompletion.status, 'updated');
    if (repeatedTerminalCompletion.status === 'updated') {
      assert.ok(repeatedTerminalCompletion.completedAt);
      assert.equal(repeatedTerminalCompletion.completionKind, 'SOURCE_RESOLVED');
      assert.equal(repeatedTerminalCompletion.canRestore, false);
    }
    const oneRowHistory = await loadNotificationInbox(user.id, access, { state: 'completed', limit: 1 });
    assert.equal(oneRowHistory.notifications.length, 1);
    assert.equal(oneRowHistory.completedCount, 3);
    assert.equal(oneRowHistory.completedBusinessCategoryCounts.PROCESS, 3);

    const obligationAReportId = await emit('PROCESS_SUPPLEMENT_OBLIGATION_REPORTED', 'obligation-a');
    const obligationBReportId = await emit('PROCESS_SUPPLEMENT_OBLIGATION_REPORTED', 'obligation-b');
    const obligationAFulfilledId = await emit('PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED', 'obligation-a');
    recipients = await prisma.systemNotificationRecipient.findMany({
      where: {
        userId: user.id,
        notificationId: { in: [obligationAReportId, obligationBReportId, obligationAFulfilledId] },
      },
    });
    assert.ok(recipients.find(item => item.notificationId === obligationAReportId)?.completedAt);
    assert.ok(recipients.find(item => item.notificationId === obligationAFulfilledId)?.completedAt);
    assert.ok(recipients.find(item => item.notificationId === obligationBReportId)?.completedAt);

    const legacyUnscopedReportId = await emit('PROCESS_SUPPLEMENT_OBLIGATION_REPORTED');
    const legacyUnscopedFulfilledId = await emit('PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED');
    recipients = await prisma.systemNotificationRecipient.findMany({
      where: { userId: user.id, notificationId: { in: [legacyUnscopedReportId, legacyUnscopedFulfilledId] } },
    });
    // Historical rows without obligationId cannot be safely paired, but a
    // report is pure progress history and therefore completes itself.
    assert.ok(recipients.find(item => item.notificationId === legacyUnscopedReportId)?.completedAt);
    assert.ok(recipients.find(item => item.notificationId === legacyUnscopedFulfilledId)?.completedAt);
  } finally {
    await prisma.systemNotification.deleteMany({ where: { dedupeKey: { startsWith: `${prefix}:` } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('completed pagination orders by recipient completion time while pending pagination keeps notification time', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `notification-pagination-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { username: prefix, passwordHash: 'integration-test-only', displayName: '通知分页用户' },
  });
  const access = resolveAccessContext([{
    profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL',
  }]);
  const now = new Date();
  try {
    const ids = await prisma.$transaction(async tx => {
      const completedRecently = await createSystemNotification(tx, {
        eventType: 'PAGINATION_COMPLETED_RECENTLY', dedupeKey: `${prefix}:completed-recently`,
        category: 'TODO', title: '创建很早但刚完成', recipientUserIds: [user.id],
      });
      const completedEarlier = await createSystemNotification(tx, {
        eventType: 'PAGINATION_COMPLETED_EARLIER', dedupeKey: `${prefix}:completed-earlier`,
        category: 'TODO', title: '创建较晚但更早完成', recipientUserIds: [user.id],
      });
      const pendingNew = await createSystemNotification(tx, {
        eventType: 'PAGINATION_PENDING_NEW', dedupeKey: `${prefix}:pending-new`,
        category: 'TODO', title: '较新的待处理', recipientUserIds: [user.id],
      });
      const pendingOld = await createSystemNotification(tx, {
        eventType: 'PAGINATION_PENDING_OLD', dedupeKey: `${prefix}:pending-old`,
        category: 'TODO', title: '较早的待处理', recipientUserIds: [user.id],
      });
      return {
        completedRecently: completedRecently!.notificationId,
        completedEarlier: completedEarlier!.notificationId,
        pendingNew: pendingNew!.notificationId,
        pendingOld: pendingOld!.notificationId,
      };
    });
    await Promise.all([
      prisma.systemNotification.update({
        where: { id: ids.completedRecently }, data: { createdAt: new Date(now.getTime() - 4 * 60_000) },
      }),
      prisma.systemNotification.update({
        where: { id: ids.completedEarlier }, data: { createdAt: new Date(now.getTime() - 3 * 60_000) },
      }),
      prisma.systemNotification.update({
        where: { id: ids.pendingNew }, data: { createdAt: new Date(now.getTime() - 1 * 60_000) },
      }),
      prisma.systemNotification.update({
        where: { id: ids.pendingOld }, data: { createdAt: new Date(now.getTime() - 2 * 60_000) },
      }),
      prisma.systemNotificationRecipient.update({
        where: { notificationId_userId: { notificationId: ids.completedRecently, userId: user.id } },
        data: {
          completedAt: new Date(now.getTime() - 10_000), completionKind: 'MANUAL',
          completionReason: '分页测试', readAt: new Date(now.getTime() - 10_000),
        },
      }),
      prisma.systemNotificationRecipient.update({
        where: { notificationId_userId: { notificationId: ids.completedEarlier, userId: user.id } },
        data: {
          completedAt: new Date(now.getTime() - 20_000), completionKind: 'MANUAL',
          completionReason: '分页测试', readAt: new Date(now.getTime() - 20_000),
        },
      }),
    ]);

    const completedFirst = await loadNotificationInbox(user.id, access, { state: 'completed', limit: 1 });
    assert.deepEqual(completedFirst.notifications.map(item => item.id), [ids.completedRecently]);
    assert.ok(completedFirst.nextCursor);
    const completedSecond = await loadNotificationInbox(user.id, access, {
      state: 'completed', limit: 1, cursor: completedFirst.nextCursor,
    });
    assert.deepEqual(completedSecond.notifications.map(item => item.id), [ids.completedEarlier]);

    const pendingFirst = await loadNotificationInbox(user.id, access, { state: 'pending', limit: 1 });
    assert.deepEqual(pendingFirst.notifications.map(item => item.id), [ids.pendingNew]);
    assert.ok(pendingFirst.nextCursor);
    const pendingSecond = await loadNotificationInbox(user.id, access, {
      state: 'pending', limit: 1, cursor: pendingFirst.nextCursor,
    });
    assert.deepEqual(pendingSecond.notifications.map(item => item.id), [ids.pendingOld]);
  } finally {
    await prisma.systemNotification.deleteMany({ where: { dedupeKey: { startsWith: `${prefix}:` } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
