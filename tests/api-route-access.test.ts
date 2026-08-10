import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessApiRoute } from '../lib/api-route-access';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';

function context(grant: AccessGrant) {
  return resolveAccessContext([grant], { now: '2026-08-10T08:00:00.000Z' });
}

test('department permission authorizes its own API reads and writes only', () => {
  const procurement = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PROCUREMENT',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PROCUREMENT',
  });
  assert.equal(canAccessApiRoute(procurement, '/api/material-follow-ups', 'GET'), true);
  assert.equal(canAccessApiRoute(procurement, '/api/material-follow-ups/1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(procurement, '/api/warehouse/tasks', 'GET'), false);
});

test('finance account cannot call summary, search or business APIs', () => {
  const finance = context({
    profile: 'FINANCE_ACCOUNT_ONLY',
    departmentCode: 'FINANCE',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:FINANCE',
  });
  assert.equal(canAccessApiRoute(finance, '/api/me', 'GET'), true);
  assert.equal(canAccessApiRoute(finance, '/api/dashboard/production-summary', 'GET'), false);
  assert.equal(canAccessApiRoute(finance, '/api/search', 'GET'), false);
});

test('GM can read mapped business APIs but cannot mutate them', () => {
  const gm = context({
    profile: 'GM_OFFICE_READER_APPROVER',
    departmentCode: 'GM_OFFICE',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });
  assert.equal(canAccessApiRoute(gm, '/api/issues', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/issues/1', 'PATCH'), false);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders', 'POST'), false);
});

test('field reporter is limited to the existing QR report API', () => {
  const reporter = context({
    profile: 'FIELD_REPORTER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'EMPLOYEE:e1',
  });
  assert.equal(canAccessApiRoute(reporter, '/api/field-report/tickets/code', 'GET'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/field-report/tickets/code/completions', 'POST'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/production/arrangements', 'GET'), false);
});

test('unknown API routes remain distinguishable for fail-closed callers', () => {
  const reporter = context({
    profile: 'FIELD_REPORTER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'EMPLOYEE:e1',
  });
  assert.equal(canAccessApiRoute(reporter, '/api/unclassified-secret', 'GET'), null);
});

test('process-route endpoints use process or production permission instead of broad work-order access', () => {
  const process = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PROCESS',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PROCESS',
  });
  assert.equal(canAccessApiRoute(process, '/api/work-orders/w1/process-route/apply-product-time', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/work-orders/w1/progress-logs', 'GET'), false);
});

test('team leaders cannot invoke workshop-wide or cross-team API operations', () => {
  const teamLeader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });
  const denied: Array<[string, string]> = [
    ['/api/work-orders/week/activate-next/commit', 'POST'],
    ['/api/abnormal-time-events/event-1/quality', 'POST'],
    ['/api/process-management/routes/route-1/completions/completion-1/withdraw', 'POST'],
    ['/api/resource-files/file-1/delete', 'POST'],
    ['/api/daily-shipments', 'POST'],
    ['/api/work-order-qr/prints', 'POST'],
    ['/api/work-orders/clear-weekly-plan/commit', 'POST'],
    ['/api/work-orders/week/close/commit', 'POST'],
    ['/api/daily-plans/organization', 'GET'],
    ['/api/work-orders/shared-work-order', 'PATCH'],
    ['/api/work-orders/shared-work-order', 'DELETE'],
  ];

  for (const [path, method] of denied) {
    assert.equal(canAccessApiRoute(teamLeader, path, method), false, `${method} ${path}`);
  }

  // General work-order operations with endpoint-level entity filters remain
  // available to the leader's own team.
  assert.equal(canAccessApiRoute(teamLeader, '/api/work-orders/w1/execution', 'PATCH'), true);
  assert.equal(canAccessApiRoute(teamLeader, '/api/work-orders/batch-execution', 'POST'), true);
});

test('planning owns week lifecycle and daily shipments while GM stays read-only', () => {
  const planning = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PLANNING',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PLANNING',
  });
  const gm = context({
    profile: 'GM_OFFICE_READER_APPROVER',
    departmentCode: 'GM_OFFICE',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });

  assert.equal(canAccessApiRoute(planning, '/api/work-orders/week/activate-next/commit', 'POST'), true);
  assert.equal(canAccessApiRoute(planning, '/api/daily-shipments', 'POST'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/history', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/diff/export.csv', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/close/preview', 'POST'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/close/commit', 'POST'), false);
  assert.equal(canAccessApiRoute(gm, '/api/daily-shipments', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/daily-shipments', 'POST'), false);
});

test('abnormal-event quality commands are quality-only and base records exclude production', () => {
  const quality = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'QUALITY',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:QUALITY',
  });
  const hr = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'HR',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:HR',
  });
  const workshop = context({
    profile: 'WORKSHOP_SUPERVISOR',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'WORKSHOP:main',
  });

  assert.equal(canAccessApiRoute(quality, '/api/abnormal-time-events/event-1/quality', 'POST'), true);
  assert.equal(canAccessApiRoute(quality, '/api/abnormal-time-events/event-1/resolve', 'POST'), true);
  assert.equal(canAccessApiRoute(hr, '/api/abnormal-time-events', 'GET'), true);
  assert.equal(canAccessApiRoute(hr, '/api/abnormal-time-events/event-1/quality', 'POST'), false);
  assert.equal(canAccessApiRoute(workshop, '/api/abnormal-time-events', 'GET'), false);
});

test('production bulk operations require workshop scope without restricting owning departments', () => {
  const workshop = context({
    profile: 'WORKSHOP_SUPERVISOR',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'WORKSHOP:main',
  });
  const process = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PROCESS',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PROCESS',
  });
  const engineering = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'ENGINEERING',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:ENGINEERING',
  });
  const business = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'BUSINESS',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:BUSINESS',
  });

  assert.equal(canAccessApiRoute(workshop, '/api/process-management/routes/r1/completions/c1/withdraw', 'POST'), true);
  assert.equal(canAccessApiRoute(workshop, '/api/resource-files/f1/delete', 'POST'), true);
  assert.equal(canAccessApiRoute(workshop, '/api/daily-plans/organization', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/process-management/routes/r1/completions/c1/withdraw', 'POST'), true);
  assert.equal(canAccessApiRoute(engineering, '/api/resource-files/f1/delete', 'POST'), true);
  assert.equal(canAccessApiRoute(engineering, '/api/work-orders', 'GET'), true);
  assert.equal(canAccessApiRoute(engineering, '/api/work-orders/w1', 'PATCH'), false);
  assert.equal(canAccessApiRoute(engineering, '/api/work-orders/w1', 'DELETE'), false);
  assert.equal(canAccessApiRoute(engineering, '/api/work-orders/w1/execution', 'PATCH'), false);
  assert.equal(canAccessApiRoute(engineering, '/api/work-orders/w1/sync-drawing-library', 'POST'), true);
  assert.equal(canAccessApiRoute(business, '/api/work-order-qr/prints', 'POST'), true);
});
