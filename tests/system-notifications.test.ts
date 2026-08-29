import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import {
  majorApprovalViewer,
  parseMajorQualityDecision,
} from '../lib/major-quality-approval';
import {
  notificationBusinessCategory,
  parseNotificationInboxState,
  notificationRequiresAction,
  notificationSnoozedUntil,
  safeNotificationTargetRoute,
} from '../lib/system-notifications';

test('notification targets accept only safe internal routes', () => {
  assert.equal(safeNotificationTargetRoute('/workspace/messages?filter=unread'), '/workspace/messages?filter=unread');
  assert.equal(safeNotificationTargetRoute(null), null);
  assert.throws(() => safeNotificationTargetRoute('https://example.com'));
  assert.throws(() => safeNotificationTargetRoute('//example.com/steal'));
  assert.throws(() => safeNotificationTargetRoute('/\\example.com/steal'));
  assert.throws(() => safeNotificationTargetRoute('/workspace/messages\nLocation: https://example.com'));
});

test('home notification command center classifies the affected business area', () => {
  assert.equal(notificationBusinessCategory({ sourceType: 'internal_quality_risk', title: '质量异常待接单' }), 'QUALITY');
  assert.equal(notificationBusinessCategory({ sourceType: 'process_route_change', title: '工艺变更待确认' }), 'PROCESS');
  assert.equal(notificationBusinessCategory({ sourceType: 'WAREHOUSE_MATERIAL_TASK', title: '物料到货待检验' }), 'MATERIAL');
  assert.equal(notificationBusinessCategory({ targetRoute: '/production?view=exceptions', title: '生产进度偏差' }), 'PRODUCTION');
  assert.equal(notificationBusinessCategory({ category: 'ACCOUNT', title: '账号授权已更新' }), 'SYSTEM');
});

test('home notification command center keeps actionable and snooze rules explicit', () => {
  assert.equal(notificationRequiresAction({ category: 'TODO', priority: 'NORMAL' }), true);
  assert.equal(notificationRequiresAction({ category: 'APPROVAL', priority: 'NORMAL' }), true);
  assert.equal(notificationRequiresAction({ category: 'SYSTEM', priority: 'URGENT', targetRoute: '/workspace/messages' }), true);
  assert.equal(notificationRequiresAction({ category: 'SYSTEM', priority: 'NORMAL', targetRoute: '/workspace/messages' }), false);

  const base = new Date('2026-08-29T00:00:00.000Z');
  assert.equal(notificationSnoozedUntil(60, base).toISOString(), '2026-08-29T01:00:00.000Z');
  assert.throws(() => notificationSnoozedUntil(4, base));
  assert.throws(() => notificationSnoozedUntil(10_081, base));
  assert.throws(() => notificationSnoozedUntil(5.5, base));
});

test('notification inbox state accepts only explicit pending or completed values', () => {
  assert.equal(parseNotificationInboxState('pending'), 'pending');
  assert.equal(parseNotificationInboxState('COMPLETED'), 'completed');
  assert.equal(parseNotificationInboxState(' completed '), 'completed');
  assert.equal(parseNotificationInboxState('all'), null);
  assert.equal(parseNotificationInboxState(''), null);
  assert.equal(parseNotificationInboxState(undefined), null);
});

test('major approval viewer and decisions keep review and final roles separate', () => {
  const quality = resolveAccessContext([{
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'QUALITY',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:QUALITY',
  }]);
  const gm = resolveAccessContext([{
    profile: 'GM_OFFICE_READER_APPROVER',
    departmentCode: 'GM_OFFICE',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  }]);
  assert.deepEqual(majorApprovalViewer(quality), { canQualityReview: true, canFinalApprove: false });
  assert.deepEqual(majorApprovalViewer(gm), { canQualityReview: false, canFinalApprove: true });
  assert.equal(parseMajorQualityDecision('APPROVE'), 'APPROVE');
  assert.equal(parseMajorQualityDecision('RETURN'), 'RETURN');
  assert.throws(() => parseMajorQualityDecision('approve'));
});
