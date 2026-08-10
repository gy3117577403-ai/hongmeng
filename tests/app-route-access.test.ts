import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessAppRoute,
  landingRouteForAccess,
  routeAccessRule,
} from '../lib/app-route-access';
import type { AccessModuleCode } from '../lib/department-access';

function access(...modules: AccessModuleCode[]) {
  return { modules };
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
  const supervisor = access('ACCOUNT_SELF', 'BASIC_SUMMARY', 'PRODUCTION');
  assert.equal(canAccessAppRoute(supervisor, '/production'), true);
  assert.equal(canAccessAppRoute(supervisor, '/workspace/daily-plans'), true);
  assert.equal(canAccessAppRoute(supervisor, '/weekly-plan-center'), false);
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
