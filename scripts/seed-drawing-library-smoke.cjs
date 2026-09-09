// Explicitly isolated verification fixture. Contains no production identifiers.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
if (process.env.DRAWING_LIBRARY_QA_ALLOW !== 'disposable-drawing-runtime') throw new Error('Disposable runtime guard required');
const prisma = new PrismaClient();
async function main() {
  const marker = 'dl' + randomUUID().replaceAll('-', '').slice(0, 8);
  const password = 'Drawing-QA-' + randomUUID() + '!Z';
  const users = {};
  for (const [role, profile] of [['admin', 'ADMIN_GLOBAL'], ['editor', 'PROCESS_SPECIALIST']]) {
    const user = await prisma.user.create({ data: {
      username: marker + '-' + role, displayName: role === 'admin' ? '图纸验收管理员' : '图纸验收工艺员',
      passwordHash: await bcrypt.hash(password, 10), laborRole: role === 'admin' ? 'ADMIN' : 'EMPLOYEE',
      accessGrants: { create: { profile, scopeKey: 'GLOBAL:DRAWING_QA', grantType: 'PRIMARY' } },
    } });
    users[role] = { id: user.id, username: user.username };
  }
  const historical = await prisma.drawingLibraryItem.create({ data: { customerName: marker + '杭州昆泰(10033)', specification: marker + '-D011601-8161-V02', productName: '测试线束', libraryKey: marker + '-historical' } });
  const archived = await prisma.drawingLibraryItem.create({ data: { customerName: marker + '重庆易猫(10199)', specification: marker + '-ARCHIVED', productName: '待恢复测试', libraryKey: marker + '-archived', deletedAt: new Date() } });
  const ambiguous = [];
  for (const suffix of ['', '(10304)']) ambiguous.push(await prisma.drawingLibraryItem.create({ data: { customerName: marker + '伽利略（天津）' + suffix, specification: marker + '-AMBIGUOUS', productName: '历史重复样例', libraryKey: marker + '-ambiguous' + suffix } }));
  return { marker, password, users, historical, archived, ambiguous };
}
main().then(data => console.log(JSON.stringify(data))).finally(() => prisma.$disconnect());
