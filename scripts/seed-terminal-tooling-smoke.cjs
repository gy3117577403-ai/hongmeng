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
  return { marker, username: user.username, password, employeeId: employee.id };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => db.$disconnect());
