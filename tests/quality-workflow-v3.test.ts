import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityAnalysisIssues, qualityReturnPath, qualityTaskPath, QUALITY_PROBLEM_CATEGORIES } from '../lib/quality-workflow-shared';
import { qualityNotificationContent, qualityNotificationOrigin } from '../lib/quality-risk-notifications';
import { qualityWorkflowAccountReady } from '../lib/quality-workflow-v3';

test('assignment requires live workbench login access, not only an active account', () => {
  const now = new Date('2026-08-28T00:00:00Z');
  const account = { isActive: true, accountStatus: 'ACTIVE', mustChangePassword: false, fieldPasswordOnly: false, lastLoginAt: null, accessGrants: [] as { profile: string; isActive: boolean; effectiveFrom: Date; effectiveTo: Date | null }[] };
  assert.equal(qualityWorkflowAccountReady(account, now), false);
  const grant = { profile: 'PROCESS_SPECIALIST', isActive: true, effectiveFrom: new Date('2026-01-01'), effectiveTo: null };
  assert.equal(qualityWorkflowAccountReady({ ...account, accessGrants: [grant] }, now), true);
  assert.equal(qualityWorkflowAccountReady({ ...account, accessGrants: [{ ...grant, effectiveTo: new Date('2026-08-01') }] }, now), false);
  assert.equal(qualityWorkflowAccountReady({ ...account, accessGrants: [{ ...grant, profile: 'FIELD_REPORTER' }] }, now), false);
});

test('v3 analysis gates and category routing do not assume final liability', () => {
  assert.deepEqual(qualityAnalysisIssues({}).map(item => item.field), ['occurrenceCause', 'rootCause', 'finalConclusion', 'correctiveAction']);
  assert.equal(qualityAnalysisIssues({ occurrenceCause: '原因', rootCause: '根因', finalConclusion: '结论', correctiveAction: '具体方案' }).length, 0);
  assert.equal(QUALITY_PROBLEM_CATEGORIES.length, 4);
  assert.equal(qualityAnalysisIssues({ occurrenceCause: '   ' }).length, 4);
});
test('task deep links preserve scoped ids but do not allow external redirects', () => {
  assert.equal(qualityTaskPath('abc', 'def'), '/workspace/quality-tasks?reportId=abc&taskId=def');
  assert.equal(qualityReturnPath('/workspace/quality-confirmation', { reportId: 'abc', taskId: '//evil.test', next: 'https://evil.test' }), '/workspace/quality-confirmation?reportId=abc');
  assert.equal(qualityReturnPath('/workspace/quality-tasks', { reportId: ['a', 'b'] }), '/workspace/quality-tasks');
});
test('notification origin is configured HTTPS and UTF8 content preserves the complete task link', () => {
  for (const value of ['http://localhost:3000', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=secret', 'https://localhost', 'https://' + 'x'.repeat(400)]) assert.equal(qualityNotificationOrigin(value), null);
  assert.equal(qualityNotificationOrigin('https://example.com/'), 'https://example.com');
  const url = 'https://example.com' + qualityTaskPath('1234', '4567');
  const content = qualityNotificationContent('待处理', '中文尺寸异常😀'.repeat(1000), url, 'abc123');
  assert.ok(Buffer.byteLength(content) <= 2000);
  assert.ok(content.includes(url));
  assert.ok(content.includes('不表示已接单'));
  assert.ok(!content.includes('\ufffd'));
});
