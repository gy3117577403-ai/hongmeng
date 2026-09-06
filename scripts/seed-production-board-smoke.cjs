const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
if (process.env.QUALITY_DATA_QA_ALLOW !== 'disposable-quality-runtime') throw new Error('Disposable runtime acknowledgement required');
const prisma = new PrismaClient();
(async () => {
  const marker = `QA-BOARD-${randomUUID().slice(0, 8)}`;
  const password = 'Disposable-Board-2026!';
  const actor = await prisma.user.create({ data: { username: marker, displayName: marker,
    passwordHash: await bcrypt.hash(password, 10), laborRole: 'ADMIN', accessGrants: { create: {
      profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:BOARD_QA', grantType: 'PRIMARY', effectiveFrom: new Date('2026-01-01'),
    } } } });
  const today = new Date(Date.now() + 8 * 3600_000);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const ids = Array.from({ length: 76 }, () => randomUUID());
  await prisma.workOrder.createMany({ data: ids.map((id, i) => ({ id, code: `${marker}-${String(i + 1).padStart(3, '0')}`,
    customerName: marker, productName: '生产执行分页验收', specification: `${marker}-${String(i + 1).padStart(3, '0')}`,
    stage: 'frontend', status: 'processing', productionTargetQty: 40, uncompletedQty: '40', completedQty: '0',
    planType: 'managed_plan', planActive: true, weekStartDate: start, weekEndDate: end })) });
  await prisma.productionPlanOrder.create({ data: { sourceOrderNo: marker, sourceLineNo: 1, customerName: marker,
    productName: marker, specification: marker, orderQuantity: 3040, orderDate: start, customerDueDate: end,
    createdById: actor.id, updatedById: actor.id, batches: { create: ids.map((id, i) => ({ batchNo: i + 1, quantity: 40,
      weekStartDate: start, weekEndDate: end, plannedCompletionDate: end, releaseState: 'active', workOrderId: id })) } } });
  console.log(JSON.stringify({ username: marker, password, keyword: marker, ids }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
