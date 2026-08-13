import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessAppRoute,
  landingRouteForAccess,
  routeAccessRule,
} from '../lib/app-route-access';
import type { AccessModuleCode, CapabilityCode } from '../lib/department-access';

function access(...modules: AccessModuleCode[]) {
  return { modules };
}

function accessWithCapabilities(modules: AccessModuleCode[], capabilities: CapabilityCode[]) {
  return { modules, capabilities };
}

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

test('GM read/approval grants map to reports and workflow but not settings', () => {
  const gm = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'MAJOR_APPROVAL');
  assert.equal(canAccessAppRoute(gm, '/workspace/reports'), true);
  assert.equal(canAccessAppRoute(gm, '/workspace/workflows'), true);
  assert.equal(canAccessAppRoute(gm, '/workspace/approvals'), true);
  assert.equal(canAccessAppRoute(gm, '/dashboard?openSettings=1'), false);
});

test('longest specific production rule is selected before general prefix', () => {
  assert.deepEqual(routeAccessRule('/production/qr-print')?.anyOf, ['PRODUCTION']);
});
