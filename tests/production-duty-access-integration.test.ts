import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { resolveAccessContext } from '../lib/department-access';
import { saveModuleAccount } from '../lib/module-account-admin';
import { adminUserInclude } from '../lib/user-access-admin';

test('unrelated module edits preserve an explicit production duty without changing its owner or expiry', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const database = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname === '/hongmeng_ci' && process.env.CI === 'true', 'Disposable loopback database required');
  const marker = `DUTY-${randomUUID().slice(0, 8)}`;
  const production = await prisma.department.findUniqueOrThrow({ where: { code: 'PRODUCTION' } });
  const planning = await prisma.department.findUniqueOrThrow({ where: { code: 'PLANNING' } });
  const employee = await prisma.employee.create({ data: { employeeNo: marker, name: marker, departmentId: planning.id, department: planning.name } });
  const admin = await prisma.user.create({ data: { username: marker + '-admin', displayName: marker, passwordHash: 'isolated-test', laborRole: 'ADMIN' } });
  const target = await prisma.user.create({ data: { username: marker, displayName: marker, passwordHash: 'isolated-test', employeeId: employee.id, accessGrants: { create: [
    { profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' },
    { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: 'MODULE:planning:COLLABORATE' },
  ] } } });
  const actor = { id: admin.id, laborRole: 'ADMIN', access: resolveAccessContext([{ profile: 'ADMIN_GLOBAL', grantType: 'PRIMARY', scopeKey: 'GLOBAL' }]) };
  const load = () => prisma.user.findUniqueOrThrow({ where: { id: target.id }, include: adminUserInclude });
  const input = async (fieldReportEnabled = true) => ({ id: target.id, employeeId: employee.id, displayName: marker, accountStatus: 'ACTIVE', workbenchEnabled: true, fieldReportEnabled,
    modulePermissions: { planning: 'COLLABORATE', 'quality-data': 'COLLABORATE' }, expectedUpdatedAt: (await load()).updatedAt.toISOString() });
  let grantId = '';
  try {
    await t.test('a checked box cannot invent a cross-department production grant', async () => {
      const before = await load();
      await assert.rejects(saveModuleAccount(actor, await input()), /生产岗位或已明确授予生产兼岗/);
      assert.deepEqual(await load(), before);
    });
    const duty = await prisma.userAccessGrant.create({ data: { userId: target.id, profile: 'FIELD_REPORTER', grantType: 'ACTING', scopeKey: `EMPLOYEE:${employee.id}`, departmentId: production.id,
      effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 86400000), grantedById: admin.id } });
    grantId = duty.id;
    await t.test('module edit retains the grant ID, interval, department and recipient identity', async () => {
      const before = await load();
      const result = await saveModuleAccount(actor, await input());
      assert.equal(result.employeeId, employee.id);
      assert.equal(result.employee?.departmentId, planning.id);
      assert.equal(result.laborRole, 'EMPLOYEE');
      assert.equal(result.accessMethods.fieldReport, true);
      assert.deepEqual(await prisma.userAccessGrant.findUniqueOrThrow({ where: { id: duty.id } }), duty);
      const after = await load();
      assert.equal(after.passwordHash, before.passwordHash);
      assert.equal(after.sessionVersion, before.sessionVersion + 1);
      assert.deepEqual(result.moduleAccess?.permissions, { planning: 'COLLABORATE', 'quality-data': 'COLLABORATE' });
      assert.equal(after.accessGrants.filter(g => g.isActive && g.profile === 'FIELD_REPORTER').length, 1);
    });
    await t.test('another employee scope, expired or inactive grants cannot be retained as authorization', async () => {
      for (const patch of [{ scopeKey: 'EMPLOYEE:someone-else' }, { effectiveTo: new Date(Date.now() - 1000) }, { isActive: false }]) {
        await prisma.userAccessGrant.update({ where: { id: duty.id }, data: patch });
        const before = await load();
        await assert.rejects(saveModuleAccount(actor, await input()), /生产岗位或已明确授予生产兼岗/);
        assert.deepEqual(await load(), before);
        await prisma.userAccessGrant.update({ where: { id: duty.id }, data: { scopeKey: duty.scopeKey, effectiveTo: duty.effectiveTo, isActive: true } });
      }
    });
    await t.test('explicitly switching off field reporting still revokes that grant', async () => {
      const result = await saveModuleAccount(actor, await input(false));
      assert.equal(result.accessMethods.fieldReport, false);
      assert.equal((await prisma.userAccessGrant.findUniqueOrThrow({ where: { id: duty.id } })).isActive, false);
      assert.equal(result.moduleAccess?.permissions.planning, 'COLLABORATE');
    });
  } finally {
    await prisma.operationLog.deleteMany({ where: { OR: [{ userId: admin.id }, { targetId: target.id }, { targetId: grantId }] } });
    await prisma.userAccessGrant.deleteMany({ where: { userId: target.id } });
    await prisma.user.deleteMany({ where: { id: { in: [target.id, admin.id] } } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.$disconnect();
  }
});
