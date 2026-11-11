import { writeFileSync, mkdirSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { qualityFixture } from '../tests/helpers/quality-correction-fixture';

async function main() {
  const db = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || (!/quality/.test(db.pathname)
    && !(process.env.QUALITY_CORRECTION_QA_ALLOW === 'disposable-quality-correction' && ['/hongmeng_ci', '/hongmeng_sample_mirror'].includes(db.pathname)))) throw Error('Disposable quality database required');
  const f = await qualityFixture({ priorActions: true, partialDownstream: true });
  const password = 'Quality-Test-2026!Only';
  await prisma.user.update({ where: { id: f.user.id }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false } });
  await prisma.userAccessGrant.create({ data: { userId: f.user.id, profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL' } });
  const viewer = await prisma.user.create({ data: { username: `${f.user.username}-viewer`, displayName: '质量测试普通员工',
    passwordHash: await bcrypt.hash(password, 10), laborRole: 'EMPLOYEE', mustChangePassword: false,
    accessGrants: { create: { profile: 'DRAWING_LIBRARY_READER', scopeKey: 'GLOBAL' } } } });
  const output = { username: f.user.username, viewer: viewer.username, password, orderId: f.order.id, routeId: f.route.id,
    completionId: f.completion.completionId, branchId: f.completion.branchWorkOrderId, stepId: f.route.steps[0].id };
  mkdirSync('output/quality-correction', { recursive: true });
  writeFileSync('output/quality-correction/fixture.json', JSON.stringify(output, null, 2));
  console.log('Disposable fixture ready:', output.orderId);
}
main().finally(() => prisma.$disconnect());
