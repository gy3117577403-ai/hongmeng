import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPORT_DOMAINS,
  defaultReportRoute,
  legacyReportRoute,
  reportBranch,
  reportDomain,
  reportRoute,
} from '../lib/report-center-navigation';

test('report center exposes independent domain and branch routes', () => {
  assert.equal(reportDomain('production')?.label, '生产结果');
  assert.deepEqual(reportDomain('production')?.branches.map(item => item.key), ['weekly-plan-attainment', 'process-bottlenecks']);
  assert.equal(reportDomain('delivery'), null);
  assert.equal(REPORT_DOMAINS.some(item => item.key === 'delivery'), false);
  assert.equal(reportBranch('people', 'team-hours'), null);
  assert.equal(reportBranch('people', 'employee-attainment')?.label, '员工每日达成');
  assert.equal(reportDomain('people')?.branches.filter(item => item.key === 'employee-attainment').length, 1);
  assert.equal(reportRoute('governance', 'missing-drawing'), '/workspace/reports/governance/missing-drawing');
  assert.equal(reportBranch('quality', 'quantity-attainment'), null);
});

test('full report users and report-only users land on an allowed independent branch', () => {
  assert.equal(defaultReportRoute(['PRODUCTION']), '/workspace/reports/production/weekly-plan-attainment');
  assert.equal(defaultReportRoute(['REPORT_CENTER']), '/workspace/reports/people/unmatched-labor');
});

test('legacy report links redirect to their closest independent branch', () => {
  assert.equal(
    legacyReportRoute({ view: 'production', section: 'load' }, ['PRODUCTION']),
    '/workspace/reports/production/process-bottlenecks',
  );
  assert.equal(
    legacyReportRoute({ view: 'labor' }, ['REPORT_CENTER']),
    '/workspace/reports/people/unmatched-labor',
  );
  assert.equal(
    legacyReportRoute({ view: 'quality', section: 'events' }, ['PLANNING']),
    '/workspace/reports/quality/event-ledger',
  );
});
