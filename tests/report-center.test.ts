import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseReportQuantity,
  reportBasisPoints,
  reportCompletenessBasisPoints,
  reportPlanningDateKey,
  reportRangeDayKeys,
  reportRisk,
  reportSampleStatus,
  reportWorkOrderStatus,
} from '../lib/report-center';

test('report quantities reject invalid values and preserve numeric strings', () => {
  assert.equal(parseReportQuantity('1,250'), 1250);
  assert.equal(parseReportQuantity(0), 0);
  assert.equal(parseReportQuantity(''), null);
  assert.equal(parseReportQuantity('-1'), null);
  assert.equal(parseReportQuantity('待确认'), null);
});

test('report basis points are capped for display rates', () => {
  assert.equal(reportBasisPoints(92, 100), 9200);
  assert.equal(reportBasisPoints(120, 100), 10_000);
  assert.equal(reportBasisPoints(120, 100, false), 12_000);
  assert.equal(reportBasisPoints(0, 0), null);
});

test('report range creates one Shanghai date key per reporting day', () => {
  const start = new Date('2026-08-17T00:00:00+08:00');
  const end = new Date('2026-08-24T00:00:00+08:00');
  assert.deepEqual(reportRangeDayKeys(start, end), [
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
    '2026-08-21', '2026-08-22', '2026-08-23',
  ]);
});

test('historical unfinished plans roll into the first day of the selected period', () => {
  const start = new Date('2026-08-17T00:00:00+08:00');
  const end = new Date('2026-08-24T00:00:00+08:00');
  assert.equal(reportPlanningDateKey({ plannedAt: new Date('2026-08-16T12:00:00+08:00'), start, end }), '2026-08-17');
  assert.equal(reportPlanningDateKey({ plannedAt: new Date('2026-08-20T12:00:00+08:00'), start, end }), '2026-08-20');
  assert.equal(reportPlanningDateKey({ plannedAt: null, start, end }), '2026-08-17');
});

test('work order status prioritizes completion and overdue risk', () => {
  const referenceAt = new Date('2026-08-18T12:00:00+08:00');
  assert.deepEqual(reportWorkOrderStatus({ completed: true, started: true, dueAt: new Date('2026-08-01'), referenceAt }), {
    status: 'completed', label: '已完成',
  });
  assert.deepEqual(reportWorkOrderStatus({ completed: false, started: true, dueAt: new Date('2026-08-17'), referenceAt }), {
    status: 'overdue', label: '已逾期',
  });
  assert.equal(reportWorkOrderStatus({ completed: false, started: true, dueAt: null, referenceAt }).status, 'in_progress');
});

test('sample status treats optional data as neutral and only flags submitted review items', () => {
  const referenceAt = new Date('2026-08-18T12:00:00+08:00');
  assert.equal(reportSampleStatus({ status: 'PLANNED', dueAt: null, referenceAt, pendingReviewCount: 0 }).status, 'pending');
  assert.equal(reportSampleStatus({ status: 'SUBMITTED', dueAt: null, referenceAt, pendingReviewCount: 2 }).status, 'review');
  assert.equal(reportSampleStatus({ status: 'COMPLETED', dueAt: null, referenceAt, pendingReviewCount: 0 }).status, 'completed');
});

test('risk and completeness use only verified core data checks', () => {
  const referenceAt = new Date('2026-08-18T12:00:00+08:00');
  assert.deepEqual(reportRisk({ status: 'completed', dueAt: new Date('2026-08-18'), referenceAt, missingDataCount: 0 }), {
    risk: 'low', label: '已完成',
  });
  assert.equal(reportRisk({ status: 'in_progress', dueAt: null, referenceAt, missingDataCount: 2 }).risk, 'high');
  assert.equal(reportRisk({ status: 'review', dueAt: null, referenceAt, missingDataCount: 0, pendingReviewCount: 1 }).risk, 'medium');
  assert.equal(reportCompletenessBasisPoints([
    { routeReady: true, standardReady: true, drawingReady: true },
    { routeReady: true, standardReady: false, drawingReady: true },
  ]), 8333);
  assert.equal(reportCompletenessBasisPoints([
    { routeReady: true, standardReady: true, drawingReady: true, materialRulePublished: true },
    { routeReady: true, standardReady: true, drawingReady: true, materialRulePublished: false },
  ]), 8750);
  assert.equal(reportCompletenessBasisPoints([]), null);
});
