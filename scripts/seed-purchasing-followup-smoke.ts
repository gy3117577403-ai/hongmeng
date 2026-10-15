import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutatePurchasing } from '../lib/purchasing-service';
import { mutateMaterialOrder } from '../lib/material-order-service';
import type { PcInput } from '../lib/purchasing-domain';
const { createFixture } = require('./seed-purchasing-smoke.cjs');

async function main() {
  const db = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
  if (process.env.PURCHASING_QA_ALLOW !== 'disposable-purchasing-runtime' || !['localhost','127.0.0.1'].includes(db.hostname) || !/(?:_ci|_test|_272|_mirror)$/.test(db.pathname)) throw Error('Disposable local purchasing database required');
  const fixture = await createFixture(prisma);
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
  const run = (input: PcInput) => mutatePurchasing(input, actor, randomUUID()) as Promise<Record<string, unknown>>;
  const entry = async (id: string) => ({ id, version: (await prisma.pcLine.findUniqueOrThrow({ where: { id } })).version });
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, buyerIds: [actor.id], purchaseApproverIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: '隔离三项补充验收' });
  const request = await run({ action: 'SAVE_REQUEST', submit: true, purpose: fixture.marker, lines: [
    { name: '可后补采购 ' + fixture.marker, spec: 'M8', quantity: 5, unit: '件', estimateCents: 525, needDate: fixture.date },
    { name: '历史计量 ' + fixture.marker, spec: 'A2006H-2X4P', quantity: 1, unit: '件', estimateCents: 525, needDate: fixture.date },
  ] });
  const [approved, legacy] = request.lineIds as string[];
  await run({ action: 'APPROVE_LINES', entries: [await entry(approved), await entry(legacy)] });
  await prisma.pcLine.update({ where: { id: legacy }, data: { unit: '5件' } });
  await run({ action: 'PURCHASE', entries: [{ ...await entry(legacy), unitPrice: '5.25' }], settlement: 'MONTHLY', supplier: '验收供应商 ' + fixture.marker, payee: '验收收款人', bank: '验收银行', account: 'TEST-272-SNAPSHOT', eta: fixture.date });
  const fund = await run({ action: 'CREATE_FUND', entries: [await entry(legacy)], amountCents: 525 });
  const f = await prisma.pcFund.findUniqueOrThrow({ where: { id: String(fund.id) } });
  await run({ action: 'APPROVE_FUNDS', id: f.id, version: f.version });
  await run({ action: 'RECEIVE', entries: [{ ...await entry(legacy), quantity: 1 }], date: fixture.date, warehouse: '采购物资仓', location: 'A01' });
  const tasks = [];
  for (const kind of ['arrival', 'duplicate']) {
    const code = fixture.marker + '-' + kind;
    const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: code, sourceLineNo: 1, productName: code, specification: code, customerName: '验收客户', orderQuantity: 30, orderDate: new Date(), customerDueDate: new Date() } });
    let task = await prisma.warehouseMaterialTask.create({ data: { planOrderId: plan.id } });
    const change = async (action: string, extra: Record<string, unknown>) => {
      const order = await mutateMaterialOrder(task.id, { action, exceptionType: 'shortage', version: task.version, requestKey: randomUUID(), ...extra }, actor.id, true);
      task = await prisma.warehouseMaterialTask.findUniqueOrThrow({ where: { id: task.id } });
      return order;
    };
    let order = await change('report_exception', { materialModel: '同型号定子', unit: '件', supplySource: 'PURCHASED', shortageQuantity: '' });
    order = await change('confirm_arrival', { exceptionId: order.events[0].id, quantity: 5, ...(kind === 'duplicate' ? { arrivalOutcome: 'COMPLETE' } : {}) });
    if (kind === 'duplicate') order = await change('report_exception', { materialModel: '同型号定子', unit: '件', supplySource: 'CUSTOMER', shortageQuantity: '' });
    tasks.push({ kind, id: task.id, code });
  }
  const lines = await prisma.pcLine.findMany({ where: { id: { in: [approved, legacy] } }, select: { id: true, number: true, name: true }, orderBy: { number: 'asc' } });
  const output = process.env.PURCHASING_FOLLOWUP_FIXTURE || 'output/playwright/purchasing-followup/fixture.json';
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ ...fixture, lines, tasks, fundId: fund.id }, null, 2));
  console.log('Disposable purchasing follow-up fixtures saved.');
}
main().finally(() => prisma.$disconnect());
