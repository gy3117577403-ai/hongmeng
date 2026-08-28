import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessAppRoute,
  landingRouteForAccess,
  routeAccessRule,
} from '../lib/app-route-access';
import type { AccessModuleCode, CapabilityCode } from '../lib/department-access';
import { REPORT_DOMAINS, reportRoute } from '../lib/report-center-navigation';

function access(...modules: AccessModuleCode[]) {
  return { modules };
}

function accessWithCapabilities(modules: AccessModuleCode[], capabilities: CapabilityCode[]) {
  return { modules, capabilities };
}

test('HR opens the employee account page without system dashboard or permissions access', () => {
  const hr = accessWithCapabilities(['HR', 'TRAINING'], ['HR:READ', 'HR:UPDATE']);
  assert.equal(canAccessAppRoute(hr, '/workspace/employees/accounts'), true);
  assert.equal(canAccessAppRoute(hr, '/dashboard'), false);
  assert.equal(canAccessAppRoute(hr, '/workspace/permissions'), false);
  assert.equal(canAccessAppRoute(accessWithCapabilities(['HR'], ['HR:READ']), '/workspace/employees/accounts'), false);
  assert.equal(canAccessAppRoute(accessWithCapabilities(['TRAINING'], ['TRAINING:UPDATE']), '/workspace/employees/accounts'), false);
});

test('HR opens all report routes without receiving production, planning or quality workspaces', () => {
  const hr = access('HR');
  assert.equal(canAccessAppRoute(hr, '/workspace/reports'), true);
  for (const domain of REPORT_DOMAINS) {
    for (const branch of domain.branches) {
      assert.equal(canAccessAppRoute(hr, reportRoute(domain.key, branch.key)), true);
    }
  }
  for (const path of ['/production', '/weekly-plan-center', '/workspace/quality', '/workspace/permissions']) {
    assert.equal(canAccessAppRoute(hr, path), false, path);
  }
  assert.equal(canAccessAppRoute(access('TRAINING'), '/workspace/reports'), false);
});

test('finance account lands on account center and cannot open business pages', () => {
  const finance = access('ACCOUNT_SELF', 'NOTIFICATIONS');
  assert.equal(landingRouteForAccess(finance), '/account');
  assert.equal(canAccessAppRoute(finance, '/account'), true);
  assert.equal(canAccessAppRoute(finance, '/home'), false);
  assert.equal(canAccessAppRoute(finance, '/production'), false);
  assert.equal(canAccessAppRoute(finance, '/workspace/reports'), false);
  assert.equal(canAccessAppRoute(finance, '/workspace/messages'), true);
  assert.equal(canAccessAppRoute(finance, '/workspace/approvals'), false);
});

test('department users receive only their mapped module entries plus shared workflow', () => {
  const procurement = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'PROCUREMENT');
  assert.equal(canAccessAppRoute(procurement, '/home'), true);
  assert.equal(canAccessAppRoute(procurement, '/workspace/procurement'), true);
  assert.equal(canAccessAppRoute(procurement, '/workspace/workflows'), true);
  assert.equal(canAccessAppRoute(procurement, '/workspace/warehouse'), false);
});

test('production supervisor can use production and planning collaboration pages', () => {
  const supervisor = accessWithCapabilities(
    ['ACCOUNT_SELF', 'BASIC_SUMMARY', 'PRODUCTION'],
    ['PRODUCTION:UPDATE'],
  );
  assert.equal(canAccessAppRoute(supervisor, '/production'), true);
  assert.equal(canAccessAppRoute(supervisor, '/workspace/daily-plans'), true);
  assert.equal(canAccessAppRoute(supervisor, '/workspace/abnormal-times'), true);
  assert.equal(canAccessAppRoute(supervisor, '/weekly-plan-center'), false);
});

test('workshop leaders receive the requested shared technical and attendance pages', () => {
  const leader = accessWithCapabilities(
    ['ACCOUNT_SELF', 'BASIC_SUMMARY', 'PRODUCTION', 'DRAWING_LIBRARY', 'ASSEMBLY_MANUALS', 'PRODUCT_TIME', 'ATTENDANCE'],
    ['PRODUCTION:UPDATE', 'DRAWING_LIBRARY:UPDATE', 'ASSEMBLY_MANUALS:UPDATE', 'PRODUCT_TIME:UPDATE', 'ATTENDANCE:UPDATE'],
  );
  assert.equal(canAccessAppRoute(leader, '/drawing-library'), true);
  assert.equal(canAccessAppRoute(leader, '/connector-assembly-manuals'), true);
  assert.equal(canAccessAppRoute(leader, '/workspace/product-times'), true);
  assert.equal(canAccessAppRoute(leader, '/workspace/attendance'), true);
  assert.equal(canAccessAppRoute(leader, '/connector-parameters'), false);
  assert.equal(canAccessAppRoute(leader, '/workspace/time-standards'), false);
  assert.equal(canAccessAppRoute(leader, '/workspace/employees'), false);
});

test('process specialist sees collaboration pages but not scheduling or QR print', () => {
  const process = accessWithCapabilities(
    ['ACCOUNT_SELF', 'BASIC_SUMMARY', 'PROCESS', 'ISSUE_MANAGEMENT', 'CHANGE_MANAGEMENT', 'DRAWING_LIBRARY', 'TERMINAL_TOOLING', 'PRODUCTION'],
    ['PROCESS:READ', 'ISSUE_MANAGEMENT:READ', 'CHANGE_MANAGEMENT:READ', 'DRAWING_LIBRARY:READ', 'TERMINAL_TOOLING:READ', 'PRODUCTION:READ'],
  );
  assert.equal(canAccessAppRoute(process, '/workspace/workflows'), true);
  assert.equal(canAccessAppRoute(process, '/workspace/issues'), true);
  assert.equal(canAccessAppRoute(process, '/workspace/changes'), true);
  assert.equal(canAccessAppRoute(process, '/drawing-library'), true);
  assert.equal(canAccessAppRoute(process, '/production'), true);
  assert.equal(canAccessAppRoute(process, '/workspace/weekly-processes'), true);
  assert.equal(canAccessAppRoute(process, '/workspace/terminal-tooling'), true);
  assert.equal(canAccessAppRoute(process, '/workspace/daily-plans'), false);
  assert.equal(canAccessAppRoute(process, '/production/qr-print'), false);
  assert.equal(canAccessAppRoute(process, '/workspace/approvals'), false);
});

test('terminal tooling is visible to workshop leaders and hidden from field reporters', () => {
  assert.equal(canAccessAppRoute(access('TERMINAL_TOOLING'), '/workspace/terminal-tooling'), true);
  assert.equal(canAccessAppRoute(access('FIELD_REPORT'), '/workspace/terminal-tooling'), false);
  assert.equal(canAccessAppRoute(access('FIELD_REPORT'), '/workspace/abnormal-times'), false);
});

test('sample QR capture is a narrow page available to field reporters', () => {
  assert.equal(canAccessAppRoute(access('FIELD_REPORT'), '/sample-capture/qr-code'), true);
  assert.equal(canAccessAppRoute(access('FIELD_REPORT'), '/production?branch=samples'), false);
  assert.equal(canAccessAppRoute(access('PLANNING'), '/sample-capture/qr-code'), true);
});

test('GM read/approval grants map to reports and workflow but not settings', () => {
  const gm = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'MAJOR_APPROVAL');
  assert.equal(canAccessAppRoute(gm, '/workspace/reports'), true);
  assert.equal(canAccessAppRoute(gm, '/workspace/workflows'), true);
  assert.equal(canAccessAppRoute(gm, '/workspace/approvals'), true);
  assert.equal(canAccessAppRoute(gm, '/dashboard?openSettings=1'), false);
});

test('personnel report reader can open reports without receiving planning or production pages', () => {
  const hrReport = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'REPORT_CENTER');
  assert.equal(canAccessAppRoute(hrReport, '/workspace/reports'), true);
  assert.equal(canAccessAppRoute(hrReport, '/weekly-plan-center'), false);
  assert.equal(canAccessAppRoute(hrReport, '/production'), false);
});

test('training collaborator opens the employee shell but not unrelated HR workspaces', () => {
  const training = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'TRAINING');
  assert.equal(canAccessAppRoute(training, '/workspace/employees?view=training'), true);
  assert.equal(canAccessAppRoute(training, '/workspace/attendance'), false);
  assert.equal(canAccessAppRoute(training, '/workspace/reports'), false);
  assert.equal(canAccessAppRoute(training, '/weekly-plan-center'), false);
});

test('longest specific production rule is selected before general prefix', () => {
  assert.deepEqual(routeAccessRule('/production/qr-print')?.anyOf, ['PRODUCTION']);
});

test('quality management parent, internal risks and 8D archive share quality and issue-management page access', () => {
  assert.equal(canAccessAppRoute(access('QUALITY'), '/workspace/quality'), true);
  assert.equal(canAccessAppRoute(access('QUALITY'), '/workspace/quality/internal-risks'), true);
  assert.equal(canAccessAppRoute(access('QUALITY'), '/workspace/quality/8d'), true);
  assert.equal(canAccessAppRoute(access('ISSUE_MANAGEMENT'), '/workspace/quality/internal-risks?workOrderId=w1'), true);
  assert.equal(canAccessAppRoute(access('ISSUE_MANAGEMENT'), '/workspace/quality/8d?issueId=i1'), true);
  assert.equal(canAccessAppRoute(access('PLANNING'), '/workspace/quality'), false);
});

test('material library is standalone and mobile upload stays quality-only', () => {
  assert.equal(canAccessAppRoute(access('QUALITY'), '/workspace/material-library'), true);
  assert.equal(canAccessAppRoute(access('QUALITY'), '/material-upload/signed-code'), true);
  assert.equal(canAccessAppRoute(access('ISSUE_MANAGEMENT'), '/workspace/material-library'), false);
  assert.equal(canAccessAppRoute(access('PLANNING'), '/material-upload/signed-code'), false);
});
