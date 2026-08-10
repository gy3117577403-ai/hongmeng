import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import {
  majorApprovalViewer,
  parseMajorQualityDecision,
} from '../lib/major-quality-approval';
import { safeNotificationTargetRoute } from '../lib/system-notifications';

test('notification targets accept only safe internal routes', () => {
  assert.equal(safeNotificationTargetRoute('/workspace/messages?filter=unread'), '/workspace/messages?filter=unread');
  assert.equal(safeNotificationTargetRoute(null), null);
  assert.throws(() => safeNotificationTargetRoute('https://example.com'));
  assert.throws(() => safeNotificationTargetRoute('//example.com/steal'));
  assert.throws(() => safeNotificationTargetRoute('/\\example.com/steal'));
  assert.throws(() => safeNotificationTargetRoute('/workspace/messages\nLocation: https://example.com'));
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
