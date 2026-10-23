import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutatePurchasing } from '../lib/purchasing-service';
import { ensureSampleWarehouse } from '../lib/sample-plan-operations';
import { sampleCurrentWeek } from '../lib/sample-plan-domain';
const { createFixture } = require('./seed-purchasing-smoke.cjs');
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.PURCHASING_QA_ALLOW !== 'disposable-purchasing-runtime' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !/(?:_ci|_test|_mirror)$/.test(url.pathname)) throw Error('Disposable local database required');
  const f = await createFixture(prisma), actor = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await mutatePurchasing({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, purchaseApproverIds: [actor.id], buyerIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: '隔离跨页页面验收' }, actor, randomUUID());
  const request = await prisma.pcRequest.create({ data: { number: f.marker, applicantId: actor.id, applicantName: actor.displayName, submitterId: actor.id, submitterName: actor.displayName, purpose: f.marker, status: 'SUBMITTED', lines: { create: Array.from({ length: 26 }, (_, i) => ({ number: `${f.marker}-${String(i).padStart(2, '0')}`, name: `${f.marker} 物品 ${i}`, spec: 'M5', unit: '件', category: '工具', needDate: f.date, quantity: 5, estimateCents: 500, actualCents: 500, payableCents: 500, status: i === 24 ? 'APPROVED' : 'ORDERED', settlement: 'ADVANCE', payee: i < 12 ? '验收收款人甲' : '验收收款人乙', payeeUserId: actor.id, bank: '验收银行', account: i < 12 ? 'QA-A' : 'QA-B', receivedQty: i === 0 ? 3 : i === 1 || i === 2 ? 5 : 0, returnedQty: i === 2 ? 2 : 0, createdAt: new Date(Date.now() - i * 1000) })) } }, include: { lines: { orderBy: { number: 'asc' } } } });
  const reserved = request.lines[25];
  await mutatePurchasing({ action: 'CREATE_FUND', entries: [{ id: reserved.id, version: reserved.version }], amountCents: 500 }, actor, randomUUID());
  const accounts = [];
  for (const level of ['COLLABORATE', 'READ']) {
    const user = await prisma.user.create({ data: { username: f.marker + '-' + level, displayName: level === 'READ' ? '仓库只读验收' : '金丹权限条件验收', passwordHash: actor.passwordHash, mustChangePassword: false, accessGrants: { create: [{ profile: 'MODULE_ACCESS', grantType: 'PRIMARY', scopeKey: 'MODULES:ON' }, { profile: 'MODULE_ACCESS', grantType: 'CONCURRENT', scopeKey: `MODULE:warehouse:${level}` }] } } });
    accounts.push({ username: user.username, id: user.id, level });
  }
  const item = await prisma.drawingLibraryItem.create({ data: { libraryKey: f.marker, specification: f.marker, customerName: '权限验收客户' } });
  const task = await prisma.sampleTask.create({ data: { code: f.marker, qrCode: f.marker, drawingLibraryItemId: item.id, customerNameSnapshot: '权限验收客户', specificationSnapshot: f.marker, taskType: 'REPEAT', sampleQuantity: 5, planWeekStartDate: new Date(sampleCurrentWeek()), dueDate: new Date(f.date), createdById: actor.id, createdByName: actor.displayName } });
  await prisma.$transaction(tx => ensureSampleWarehouse(tx, task));
  const output = process.env.PURCHASING_SELECTION_FIXTURE || '.local/purchasing-selection-fixture.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ ...f, lines: request.lines.map(l => ({ id: l.id, number: l.number, name: l.name })), accounts, taskId: task.id }, null, 2));
  console.log('Disposable purchasing-selection and warehouse sample fixtures ready.');
}
main().finally(() => prisma.$disconnect());
