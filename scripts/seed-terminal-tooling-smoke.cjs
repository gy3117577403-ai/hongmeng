const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
if (process.env.TOOLING_QA_ALLOW !== 'disposable-tooling-runtime') throw Error('Disposable runtime guard required');
const db = new PrismaClient();
async function main() {
  const marker = 'blade-qa-' + randomUUID().slice(0, 8), password = 'Blade-Smoke-2026!Z';
  const user = await db.user.create({ data: { username: marker, displayName: '刀位规格验收', passwordHash: await bcrypt.hash(password, 10), laborRole: 'ADMIN', mustChangePassword: false, isActive: true, accountStatus: 'ACTIVE', accessGrants: { create: { profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL' } } } });
  return { marker, username: user.username, password };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => db.$disconnect());
