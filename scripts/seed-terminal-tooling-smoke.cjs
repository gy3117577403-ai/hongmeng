const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
if (process.env.TOOLING_QA_ALLOW !== 'disposable-tooling-runtime') throw Error('Disposable runtime guard required');
const db = new PrismaClient();
async function main() {
  const marker = 'blade-qa-' + randomUUID().slice(0, 8), password = 'Blade-Smoke-2026!Z';
  const employee = await db.employee.create({ data: { employeeNo: marker.toUpperCase(), name: '调模镜像验收', department: '生产部', team: '调模组' } });
  const user = await db.user.create({ data: { username: marker, displayName: '刀位规格验收', passwordHash: await bcrypt.hash(password, 10), laborRole: 'ADMIN', mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE', accessGrants: { create: { profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL' } } } });
  await db.user.update({ where: { id: user.id }, data: { employeeId: employee.id } });
  const members = {};
  for (const level of ['READ', 'COLLABORATE']) {
    const e = await db.employee.create({ data: { employeeNo: marker.toUpperCase() + '-' + level, name: '专模验收-' + level, department: '工程部' } });
    const member = await db.user.create({ data: { username: marker + '-' + level.toLowerCase(), displayName: e.name, employeeId: e.id, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE', accessGrants: { create: [ { profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' }, { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: 'MODULE:technology:' + level } ] } } });
    members[level] = { username: member.username, employeeId: e.id };
  }
  return { marker, username: user.username, password, employeeId: employee.id, members };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => db.$disconnect());
