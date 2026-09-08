import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyHomeDashboardData } from '../lib/home-dashboard';
import { scopeHomeDashboardData } from '../lib/home-dashboard-access';
import type { HomeActionItem } from '../types/home-dashboard';

test('empty home dashboard preserves the four operational workstreams', () => {
  const data = emptyHomeDashboardData('temporarily unavailable', new Date('2026-07-25T02:00:00.000Z'));

  assert.deepEqual(
    data.workstreams.map(stream => stream.id),
    ['production', 'warehouse', 'material', 'labor'],
  );
  assert.deepEqual(
    data.workstreams.map(stream => stream.count),
    [0, 0, 0, 0],
  );
  assert.match(data.workstreams[0].route, /^\/production/);
  assert.match(data.workstreams[1].route, /^\/workspace\/warehouse/);
  assert.match(data.workstreams[2].route, /^\/workspace\/procurement/);
  assert.match(data.workstreams[3].route, /^\/workspace\/reports\?view=labor/);
  assert.equal(data.issueCount, null);
});

test('issue total remains independent of the five-item preview for authorized viewers', () => {
  const data = emptyHomeDashboardData('', new Date('2026-09-08T02:00:00.000Z'));
  data.issueCount = 47;
  data.issues = Array.from({ length: 5 }, (_, index): HomeActionItem => ({
    id: `issue-${index}`, workOrderId: '', sourceModule: '问题管理', type: 'issue',
    title: `问题 ${index}`, subtitle: '', customerName: '', specification: '',
    priority: 'normal', status: 'open', occurredAt: '', dateLabel: '',
    targetRoute: `/workspace/issues?issueId=issue-${index}`,
  }));

  const qualityView = scopeHomeDashboardData(data, { modules: ['BASIC_SUMMARY', 'QUALITY'] });
  const issueManagementView = scopeHomeDashboardData(data, { modules: ['BASIC_SUMMARY', 'ISSUE_MANAGEMENT'] });
  assert.equal(qualityView.issueCount, 47);
  assert.equal(qualityView.issues.length, 5);
  assert.equal(issueManagementView.issueCount, 47);
  assert.equal(issueManagementView.issues.length, 5);

  const summaryView = scopeHomeDashboardData(data, { modules: ['BASIC_SUMMARY', 'ACCOUNT_SELF'] });
  assert.equal(summaryView.issueCount, null);
  assert.deepEqual(summaryView.issues, []);
  assert.equal(data.issueCount, 47);
  assert.equal(data.issues.length, 5);
});

test('an authorized zero issue count is distinct from unavailable data', () => {
  const data = emptyHomeDashboardData('load failed');
  assert.equal(scopeHomeDashboardData(data, { modules: ['QUALITY'] }).issueCount, null);
  data.issueCount = 0;
  assert.equal(scopeHomeDashboardData(data, { modules: ['QUALITY'] }).issueCount, 0);
  assert.equal(scopeHomeDashboardData(data, { modules: ['PRODUCTION'] }).issueCount, null);
});
