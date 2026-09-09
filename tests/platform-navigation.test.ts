import assert from 'node:assert/strict';
import test from 'node:test';
import { activePlatformNavigationGroup, activePlatformNavigationItem, PLATFORM_NAVIGATION_GROUPS, PLATFORM_SYSTEM_GROUP, platformNavigationForUser, platformNavigationHref, restorePlatformNavigationGroup } from '../lib/platform-navigation';

test('quality data and its descendants select data, without also selecting quality management', () => {
  for (const href of ['/workspace/quality/data', '/workspace/quality/data/?period=week#events', '/workspace/quality/data/events/one']) {
    assert.equal(activePlatformNavigationItem(href)?.label, '质量数据');
    assert.equal(activePlatformNavigationGroup(href, PLATFORM_NAVIGATION_GROUPS), 'quality');
  }
  assert.equal(activePlatformNavigationItem('/workspace/quality/internal-risks?reportId=one')?.label, '质量管理');
  assert.equal(activePlatformNavigationItem('/workspace/quality-tasks')?.label, '我的质量任务');
  assert.equal(activePlatformNavigationItem('/workspace/quality-confirmation')?.label, '品质确认');
  assert.equal(activePlatformNavigationItem('/workspace/quality-fake'), undefined);
});

test('HR deep links and report branches retain their owning navigation entry', () => {
  assert.equal(activePlatformNavigationItem('/workspace/employees/accounts?employeeId=one')?.label, '人事管理');
  assert.equal(activePlatformNavigationItem('/workspace/reports/quality?tab=events')?.label, '报表中心');
  assert.equal(activePlatformNavigationItem('/dashboard'), undefined);
  assert.equal(activePlatformNavigationItem('/dashboard?openSettings=1')?.label, '系统设置');
});

test('quality-data-only access exposes only its allowed leaf and no empty business groups', () => {
  const groups = platformNavigationForUser({ access: { modules: ['QUALITY_DATA'], capabilities: [] } as never, canAccessDailyPlans: false, canAccessWeeklyProcesses: false });
  assert.deepEqual(groups.map(group => [group.id, group.items.map(item => item.label)]), [['quality', ['质量数据']]]);
});

test('daily and weekly planning flags still filter navigation in addition to route capabilities', () => {
  const groups = platformNavigationForUser({ access: { modules: ['PRODUCTION'], capabilities: ['PRODUCTION:UPDATE'] } as never, canAccessDailyPlans: false, canAccessWeeklyProcesses: false });
  const hrefs = groups.flatMap(group => group.items.map(item => item.href));
  assert.ok(hrefs.includes('/production'));
  assert.ok(hrefs.includes('/workspace/wip'));
  assert.ok(!hrefs.includes('/workspace/daily-plans'));
  assert.ok(!hrefs.includes('/workspace/weekly-processes'));
  assert.ok(!hrefs.includes('/workspace/permissions'));
});

test('group preferences remember deliberate collapse, recover from invalid data, and follow new routes', () => {
  const groups = [...PLATFORM_NAVIGATION_GROUPS, PLATFORM_SYSTEM_GROUP];
  const saved = (expandedGroup: unknown, route = '/workspace/quality/data') => JSON.stringify({ version: 1, route, expandedGroup });
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', saved(null), groups), null);
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', saved('production'), groups), 'production');
  assert.equal(restorePlatformNavigationGroup('/workspace/employees', saved('production'), groups), 'people');
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', saved('deleted-group'), groups), 'quality');
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', '{broken', groups), 'quality');
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', 'null', groups), 'quality');
  assert.equal(restorePlatformNavigationGroup('/workspace/quality/data', saved('system'), groups.filter(group => group.id === 'quality')), 'quality');
});

test('production and planning retain direct entry and sample mode without forcing the mode chooser', () => {
  const production = PLATFORM_NAVIGATION_GROUPS[0].items[0];
  const planning = PLATFORM_NAVIGATION_GROUPS[0].items[1];
  assert.equal(platformNavigationHref(production, '/home', 'mass'), '/production');
  assert.equal(platformNavigationHref(planning, '/production?branch=samples', 'sample'), '/weekly-plan-center?branch=samples');
  assert.equal(platformNavigationHref(production, '/production?branch=samples&week=2026-09-07', 'sample'), '/production?branch=samples&week=2026-09-07');
  const warehouse = PLATFORM_NAVIGATION_GROUPS.find(group => group.id === 'materials')!.items.find(item => item.href === '/workspace/warehouse')!;
  assert.equal(platformNavigationHref(warehouse, '/production?branch=samples', 'sample'), '/workspace/warehouse?chooseMode=1&branch=samples');
});
