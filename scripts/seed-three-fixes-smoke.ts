import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { poolCommand } from '../lib/order-pool-service';
import { mutateMaterialOrder, readMaterialOrder } from '../lib/material-order-service';
import { mutatePurchasing } from '../lib/purchasing-service';
async function main() {
  assert.equal(process.env.THREE_FIXES_QA_ALLOW, 'disposable-three-fixes-runtime');
  assert.ok(/_(ci|mirror)$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const marker = 'TRI-' + randomUUID().slice(0, 8), password = 'Disposable-Three-Fixes-2026!';
  const department = await prisma.department.upsert({ where: { code: 'PRODUCTION' }, create: { code: 'PRODUCTION', name: '生产部' }, update: {} });
  const user = await prisma.user.create({ data: { username: marker, displayName: '三项修复验收', laborRole: 'ADMIN', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false,
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', departmentId: department.id, scopeKey: 'GLOBAL:' + marker } } } });
  const created = await poolCommand({ action: 'create', requestKey: randomUUID(), row: { customerName: marker, specification: marker, productName: '线束', sourceOrderNo: marker, sourceLineNo: 1, orderQuantity: 25, preparationQuantity: 25, unitMinutes: 1 } }, user.id) as { ids: string[] };
  let order = await readMaterialOrder((await prisma.warehouseMaterialTask.findUniqueOrThrow({ where: { planOrderId: created.ids[0] } })).id);
  for (const [model, quantity] of [['端子A', 50], ['端子B', 50], ['壳体C', 100]] as const) {
    order = await mutateMaterialOrder(order.id, { action: 'report_exception', version: order.version, requestKey: randomUUID(), materialModel: model, shortageQuantity: quantity, unit: '个', supplySource: 'PURCHASED', exceptionType: 'shortage' }, user.id, true);
    order = await mutateMaterialOrder(order.id, { action: 'report_arrival', version: order.version, requestKey: randomUUID(), exceptionId: order.events.find(e => e.model === model)!.id, quantity, logisticsMode: 'PICKUP' }, user.id, false);
  }
  const run = (input: Record<string, unknown>) => mutatePurchasing(input, user, randomUUID());
  const s = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: s?.version, ownerId: user.id, reason: marker, purchaseApproverIds: [user.id], buyerIds: [user.id], fundApproverIds: [user.id], financeIds: [user.id] });
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const request = await run({ action: 'SAVE_REQUEST', submit: true, purpose: marker, lines: [{ name: marker + ' 垫付物资', spec: 'M8', quantity: 10, unit: '件', estimateCents: 10000, needDate: date }] }) as { lineIds: string[] };
  const id = request.lineIds[0], entry = async () => ({ id, version: (await prisma.pcLine.findUniqueOrThrow({ where: { id } })).version });
  await run({ action: 'APPROVE_LINES', entries: [await entry()] });
  await run({ action: 'PURCHASE', entries: [{ ...await entry(), actualCents: 10000 }], supplier: marker, settlement: 'ADVANCE', payeeUserId: user.id, payee: marker, bank: '验收银行', account: 'TEST-ONLY', eta: date });
  await run({ action: 'RECEIVE', entries: [{ ...await entry(), quantity: 10 }], date, warehouse: '测试仓', location: 'A' });
  const dir = path.resolve(process.env.THREE_FIXES_QA_OUTPUT || 'output/playwright/three-fixes'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ marker, password, username: user.username, orderId: order.id, lineId: id }, null, 2));
  console.log('Three-fix disposable browser fixture prepared.');
}
main().finally(() => prisma.$disconnect());
