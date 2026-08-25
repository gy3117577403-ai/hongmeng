import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRouteAccessRule, canAccessApiRoute } from '../lib/api-route-access';
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
  assert.equal(canAccessApiRoute(finance, '/api/notifications', 'GET'), true);
  assert.equal(canAccessApiRoute(finance, '/api/notifications/n1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(finance, '/api/major-quality-approvals', 'GET'), false);
});

test('major quality commands preserve quality review and GM final-decision separation', () => {
  const quality = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'QUALITY',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:QUALITY',
  });
  const gm = context({
    profile: 'GM_OFFICE_READER_APPROVER',
    departmentCode: 'GM_OFFICE',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });
  const planning = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PLANNING',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PLANNING',
  });

  assert.equal(canAccessApiRoute(quality, '/api/major-quality-approvals', 'GET'), true);
  assert.equal(canAccessApiRoute(quality, '/api/issues/assignee-options', 'GET'), true);
  assert.equal(canAccessApiRoute(quality, '/api/issues/detected', 'GET'), true);
  assert.equal(canAccessApiRoute(quality, '/api/issues/i1/major-approval/quality-review', 'POST'), true);
  assert.equal(canAccessApiRoute(quality, '/api/issues/i1/major-approval/final-decision', 'POST'), false);
  assert.equal(canAccessApiRoute(gm, '/api/major-quality-approvals', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/issues/assignee-options', 'GET'), false);
  assert.equal(canAccessApiRoute(gm, '/api/issues/i1/major-approval/quality-review', 'POST'), false);
  assert.equal(canAccessApiRoute(gm, '/api/issues/i1/major-approval/final-decision', 'POST'), true);
  assert.equal(canAccessApiRoute(planning, '/api/major-quality-approvals', 'GET'), false);
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

test('field reporter can use QR reporting and its independent abnormal-time command only', () => {
  const reporter = context({
    profile: 'FIELD_REPORTER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'EMPLOYEE:e1',
  });
  assert.equal(canAccessApiRoute(reporter, '/api/field-report/tickets/code', 'GET'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/field-report/tickets/code/completions', 'POST'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/field-report/tickets/code/abnormal-time-events', 'POST'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/abnormal-time-events', 'GET'), false);
  assert.equal(canAccessApiRoute(reporter, '/api/production/arrangements', 'GET'), false);
  assert.equal(canAccessApiRoute(reporter, '/api/notifications', 'GET'), false);
});

test('sample capture is available to field reporters while plan and review commands stay separated', () => {
  const reporter = context({
    profile: 'FIELD_REPORTER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'EMPLOYEE:e1',
  });
  const planning = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PLANNING',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PLANNING',
  });

  assert.equal(canAccessApiRoute(reporter, '/api/sample-tasks/code/qr-code', 'GET'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-tasks/task-1/entries', 'POST'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-entries/entry-1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-photos/photo-1', 'DELETE'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-tasks/task-1/submit', 'POST'), true);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-tasks', 'POST'), false);
  assert.equal(canAccessApiRoute(reporter, '/api/sample-tasks/task-1/review', 'POST'), false);
  assert.equal(canAccessApiRoute(planning, '/api/sample-tasks', 'POST'), true);
  assert.equal(canAccessApiRoute(planning, '/api/sample-tasks/task-1/review', 'POST'), true);
});

test('production dispatch export follows scoped production access', () => {
  const supervisor = context({
    profile: 'WORKSHOP_SUPERVISOR',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'WORKSHOP:PRODUCTION',
  });
  const teamLeader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });
  assert.equal(canAccessApiRoute(supervisor, '/api/export/production-dispatch.xlsx', 'GET'), true);
  assert.equal(canAccessApiRoute(teamLeader, '/api/export/production-dispatch.xlsx', 'GET'), true);
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

test('process specialist can collaborate without receiving scheduling, reporting or approval powers', () => {
  const process = context({
    profile: 'PROCESS_SPECIALIST',
    departmentCode: 'PROCESS',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PROCESS',
  });

  assert.equal(canAccessApiRoute(process, '/api/workflows', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/production', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/production/arrangements', 'PATCH'), false);
  assert.equal(canAccessApiRoute(process, '/api/weekly-processes', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/weekly-processes/worker-presets', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/weekly-processes/worker-presets', 'PUT'), false);
  assert.equal(canAccessApiRoute(process, '/api/daily-plans', 'GET'), false);
  assert.equal(canAccessApiRoute(process, '/api/daily-plan-tasks', 'GET'), false);

  assert.equal(canAccessApiRoute(process, '/api/issues', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/issues', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/issues/i1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(process, '/api/issues/i1/transition', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/issues/i1', 'DELETE'), false);
  assert.equal(canAccessApiRoute(process, '/api/issues/from-production-alert', 'POST'), false);
  assert.equal(canAccessApiRoute(process, '/api/issues/detected', 'GET'), false);
  assert.equal(canAccessApiRoute(process, '/api/issues/i1/major-approval/quality-review', 'POST'), false);

  assert.equal(canAccessApiRoute(process, '/api/changes', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/changes', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/changes/c1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(process, '/api/changes/c1/transition', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/changes/c1', 'DELETE'), false);

  assert.equal(canAccessApiRoute(process, '/api/drawing-library', 'GET'), true);
  assert.equal(canAccessApiRoute(process, '/api/drawing-library', 'POST'), false);
  assert.equal(canAccessApiRoute(process, '/api/terminal-tooling/terminals', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/terminal-tooling/blades/blade-1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(process, '/api/terminal-tooling/setups/setup-1/publish', 'POST'), true);
  assert.equal(canAccessApiRoute(process, '/api/export/production-dispatch.xlsx', 'GET'), false);
  assert.equal(canAccessApiRoute(process, '/api/work-order-qr/prints/packet', 'GET'), false);
  assert.equal(canAccessApiRoute(process, '/api/major-quality-approvals', 'GET'), false);
});

test('8D archive APIs reuse quality action permissions without creating a new role system', () => {
  const quality = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'QUALITY',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:QUALITY',
  });
  const planning = context({
    profile: 'DEPARTMENT_FULL',
    departmentCode: 'PLANNING',
    grantType: 'PRIMARY',
    scopeKey: 'DEPARTMENT:PLANNING',
  });
  assert.equal(canAccessApiRoute(quality, '/api/quality/8d', 'GET'), true);
  assert.equal(canAccessApiRoute(quality, '/api/quality/8d', 'POST'), true);
  assert.equal(canAccessApiRoute(quality, '/api/quality/8d/r1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(quality, '/api/quality/8d/r1', 'DELETE'), true);
  assert.equal(canAccessApiRoute(planning, '/api/quality/8d', 'GET'), false);
});

test('drawing reader and editor share data while write and destructive actions remain separated', () => {
  const reader = context({
    profile: 'DRAWING_LIBRARY_READER',
    departmentCode: 'QUALITY',
    grantType: 'CONCURRENT',
    scopeKey: 'GLOBAL:DRAWING_LIBRARY',
  });
  const editor = context({
    profile: 'DRAWING_LIBRARY_EDITOR',
    departmentCode: 'ENGINEERING',
    grantType: 'CONCURRENT',
    scopeKey: 'GLOBAL:DRAWING_LIBRARY',
  });

  assert.equal(canAccessApiRoute(reader, '/api/drawing-library', 'GET'), true);
  assert.equal(canAccessApiRoute(reader, '/api/drawing-library/item-1/files/upload', 'POST'), false);
  assert.equal(canAccessApiRoute(editor, '/api/drawing-library', 'POST'), true);
  assert.equal(canAccessApiRoute(editor, '/api/drawing-library/item-1/files/upload', 'POST'), true);
  assert.equal(canAccessApiRoute(editor, '/api/drawing-library/files/file-1', 'DELETE'), false);
  assert.equal(canAccessApiRoute(editor, '/api/drawing-library/item-1/sop/publish', 'POST'), false);
});

test('personnel report reader receives only read-only people report APIs', () => {
  const people = context({
    profile: 'REPORT_PEOPLE_READER',
    departmentCode: 'HR',
    grantType: 'CONCURRENT',
    scopeKey: 'GLOBAL:REPORT_PEOPLE',
  });

  assert.equal(canAccessApiRoute(people, '/api/reports/employee-attainment', 'GET'), true);
  assert.equal(canAccessApiRoute(people, '/api/reports/overview', 'GET'), false);
  assert.equal(canAccessApiRoute(people, '/api/reports/abnormal-time', 'GET'), false);
  assert.equal(canAccessApiRoute(people, '/api/process-labor-pools', 'GET'), true);
  assert.equal(canAccessApiRoute(people, '/api/process-labor-pools/pool-1/claims', 'POST'), false);
});

test('training collaborator reads shared employees and skills while owning the training workflow only', () => {
  const training = context({
    profile: 'TRAINING_COLLABORATOR',
    departmentCode: 'HR',
    grantType: 'CONCURRENT',
    scopeKey: 'GLOBAL:TRAINING',
  });

  assert.equal(canAccessApiRoute(training, '/api/training/workbench', 'GET'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/courses', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/transition', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/change-preview', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/delete-preview', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/archive', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/unarchive', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/plans/plan-1/restore', 'POST'), true);
  assert.equal(apiRouteAccessRule('/api/training/plans/plan-1/change-preview')?.action, 'UPDATE');
  assert.equal(apiRouteAccessRule('/api/training/plans/plan-1/delete-preview')?.action, 'DELETE');
  assert.equal(apiRouteAccessRule('/api/training/plans/plan-1/archive')?.action, 'EXECUTE_WORKFLOW');
  assert.equal(canAccessApiRoute(training, '/api/training/participants/person-1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/sessions/session-1/qr-windows', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/sessions/session-1/start', 'POST'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/session-attendance/attendance-1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(training, '/api/training/export.xlsx', 'GET'), true);
  assert.equal(canAccessApiRoute(training, '/api/employees', 'GET'), true);
  assert.equal(canAccessApiRoute(training, '/api/employees', 'POST'), false);
  assert.equal(canAccessApiRoute(training, '/api/skills', 'GET'), true);
  assert.equal(canAccessApiRoute(training, '/api/skills', 'POST'), false);
  assert.equal(canAccessApiRoute(training, '/api/attendance/records', 'GET'), false);
  assert.equal(canAccessApiRoute(training, '/api/attendance/calendar', 'GET'), false);
  assert.equal(canAccessApiRoute(training, '/api/recruitment/demands', 'GET'), false);
});

test('training self-service QR routes stay outside HR capability routing and enforce participant identity in the handler', () => {
  const ordinaryEmployee = context({
    profile: 'FIELD_REPORTER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'SELF:FIELD_REPORT',
  });

  assert.equal(canAccessApiRoute(ordinaryEmployee, '/api/training-self/scan/code', 'GET'), null);
  assert.equal(canAccessApiRoute(ordinaryEmployee, '/api/training-self/scan/code/check-in', 'POST'), null);
  assert.equal(canAccessApiRoute(ordinaryEmployee, '/api/training-self/scan/code/feedback', 'PUT'), null);
  assert.equal(canAccessApiRoute(ordinaryEmployee, '/api/training/sessions/session-1/live', 'GET'), false);
  assert.equal(canAccessApiRoute(ordinaryEmployee, '/api/training/sessions/session-1/start', 'POST'), false);
});

test('workshop leaders can read terminal tooling but cannot change or publish it', () => {
  const supervisor = context({
    profile: 'WORKSHOP_SUPERVISOR',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'WORKSHOP:PRODUCTION',
  });
  assert.equal(canAccessApiRoute(supervisor, '/api/terminal-tooling/overview', 'GET'), true);
  assert.equal(canAccessApiRoute(supervisor, '/api/terminal-tooling/setups', 'GET'), true);
  assert.equal(canAccessApiRoute(supervisor, '/api/terminal-tooling/terminals', 'POST'), false);
  assert.equal(canAccessApiRoute(supervisor, '/api/terminal-tooling/blades/blade-1', 'PATCH'), false);
  assert.equal(canAccessApiRoute(supervisor, '/api/terminal-tooling/setups/setup-1/publish', 'POST'), false);
});

test('workshop leaders can receive and close ordinary issues without major-quality or delete powers', () => {
  const leader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });

  assert.equal(canAccessApiRoute(leader, '/api/issues', 'GET'), true);
  assert.equal(canAccessApiRoute(leader, '/api/issues', 'POST'), true);
  assert.equal(canAccessApiRoute(leader, '/api/issues/assignee-options', 'GET'), true);
  assert.equal(canAccessApiRoute(leader, '/api/issues/i1', 'PATCH'), true);
  assert.equal(canAccessApiRoute(leader, '/api/issues/i1/transition', 'POST'), true);
  assert.equal(canAccessApiRoute(leader, '/api/issues/i1', 'DELETE'), false);
  assert.equal(canAccessApiRoute(leader, '/api/issues/i1/major-approval/quality-review', 'POST'), false);
  assert.equal(canAccessApiRoute(leader, '/api/issues/i1/major-approval/final-decision', 'POST'), false);
});

test('workshop team leaders read shared data and manage every opened technical module', () => {
  const leader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });
  const readable = [
    '/api/drawing-library',
    '/api/connector-assembly-manuals',
    '/api/connector-assembly-manual-versions/version-1',
    '/api/connector-assembly-manual-assets/asset-1/content',
    '/api/connector-parameters',
    '/api/product-time-profiles',
    '/api/product-time-profiles/item-1',
    '/api/product-time-deployments/deployment-1',
    '/api/attendance/employees',
    '/api/attendance/records',
  ];
  for (const path of readable) assert.equal(canAccessApiRoute(leader, path, 'GET'), true, path);

  const allowedWrites: Array<[string, string]> = [
    ['/api/drawing-library', 'POST'],
    ['/api/drawing-library/item-1/sop/publish', 'POST'],
    ['/api/connector-assembly-manuals', 'POST'],
    ['/api/connector-assembly-manual-versions/version-1', 'PATCH'],
    ['/api/connector-assembly-manual-assets/asset-1', 'DELETE'],
    ['/api/product-time-profiles/item-1', 'PUT'],
    ['/api/product-time-profiles/item-1/publish', 'POST'],
    ['/api/terminal-tooling/terminals', 'POST'],
    ['/api/terminal-tooling/setups/setup-1/publish', 'POST'],
  ];
  for (const [path, method] of allowedWrites) {
    assert.equal(canAccessApiRoute(leader, path, method), true, `${method} ${path}`);
  }
  assert.equal(canAccessApiRoute(leader, '/api/attendance/records', 'POST'), true);
  assert.equal(canAccessApiRoute(leader, '/api/employees', 'GET'), false);
});

test('team leaders can invoke workshop-wide operations but not unopened Planning lifecycle commands', () => {
  const teamLeader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });
  const denied: Array<[string, string]> = [
    ['/api/work-orders/week/activate-next/commit', 'POST'],
    ['/api/work-orders/clear-weekly-plan/commit', 'POST'],
    ['/api/work-orders/week/close/commit', 'POST'],
  ];

  for (const [path, method] of denied) {
    assert.equal(canAccessApiRoute(teamLeader, path, method), false, `${method} ${path}`);
  }

  const allowed: Array<[string, string]> = [
    ['/api/abnormal-time-events/event-1/quality', 'POST'],
    ['/api/abnormal-time-events/event-1/resolve', 'POST'],
    ['/api/process-management/routes/route-1/completions/completion-1/withdraw', 'POST'],
    ['/api/resource-files/file-1/delete', 'POST'],
    ['/api/daily-shipments', 'POST'],
    ['/api/work-order-qr/prints', 'POST'],
    ['/api/work-order-qr/prints/readiness', 'POST'],
    ['/api/daily-plans/organization', 'GET'],
    ['/api/work-orders/shared-work-order', 'PATCH'],
    ['/api/work-orders/shared-work-order', 'DELETE'],
    ['/api/work-orders/w1/execution', 'PATCH'],
    ['/api/work-orders/batch-execution', 'POST'],
  ];
  for (const [path, method] of allowed) {
    assert.equal(canAccessApiRoute(teamLeader, path, method), true, `${method} ${path}`);
  }
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
  assert.equal(canAccessApiRoute(planning, '/api/planning/weekly-plan-export/preview', 'POST'), true);
  assert.equal(canAccessApiRoute(planning, '/api/planning/weekly-plan-export.xlsx', 'GET'), true);
  assert.equal(canAccessApiRoute(planning, '/api/daily-shipments', 'POST'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/history', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/diff/export.csv', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/close/preview', 'POST'), true);
  assert.equal(canAccessApiRoute(gm, '/api/work-orders/week/close/commit', 'POST'), false);
  assert.equal(canAccessApiRoute(gm, '/api/daily-shipments', 'GET'), true);
  assert.equal(canAccessApiRoute(gm, '/api/daily-shipments', 'POST'), false);
  assert.equal(canAccessApiRoute(gm, '/api/planning/weekly-plan-export/preview', 'POST'), true);
  assert.equal(canAccessApiRoute(gm, '/api/planning/weekly-plan-export.xlsx', 'GET'), true);
});

test('abnormal-event review is available to quality, workshop supervisors and team leaders', () => {
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
  const teamLeader = context({
    profile: 'WORKSHOP_TEAM_LEADER',
    departmentCode: 'PRODUCTION',
    grantType: 'PRIMARY',
    scopeKey: 'TEAM:A',
  });

  assert.equal(canAccessApiRoute(quality, '/api/abnormal-time-events/event-1/quality', 'POST'), true);
  assert.equal(canAccessApiRoute(quality, '/api/abnormal-time-events/event-1/resolve', 'POST'), true);
  assert.equal(canAccessApiRoute(hr, '/api/abnormal-time-events', 'GET'), true);
  assert.equal(canAccessApiRoute(hr, '/api/abnormal-time-events/event-1/quality', 'POST'), false);
  assert.equal(canAccessApiRoute(workshop, '/api/abnormal-time-events', 'GET'), true);
  assert.equal(canAccessApiRoute(workshop, '/api/abnormal-time-events/event-1/quality', 'POST'), true);
  assert.equal(canAccessApiRoute(teamLeader, '/api/abnormal-time-events', 'GET'), true);
  assert.equal(canAccessApiRoute(teamLeader, '/api/abnormal-time-events/event-1/quality', 'POST'), true);
  assert.equal(canAccessApiRoute(teamLeader, '/api/abnormal-time-events/event-1/resolve', 'POST'), true);
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
  assert.equal(canAccessApiRoute(business, '/api/work-order-qr/prints/readiness', 'POST'), true);
});
