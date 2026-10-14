import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutatePurchasing } from '../lib/purchasing-service';
import { naturalProductionWeek } from '../lib/production-execution';
import type { PcInput } from '../lib/purchasing-domain';
const { createFixture } = require('./seed-purchasing-smoke.cjs');

async function main() {
  const db = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
  if (process.env.PURCHASING_QA_ALLOW !== 'disposable-purchasing-runtime' || !['localhost','127.0.0.1'].includes(db.hostname) || !/(?:_ci|_test|_271|_mirror)$/.test(db.pathname)) throw Error('Disposable local purchasing database required');
  const fixture = await createFixture(prisma);
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
  const run = (input: PcInput) => mutatePurchasing(input, actor, randomUUID()) as Promise<Record<string, unknown>>;
  const entry = async (id: string) => ({ id, version: (await prisma.pcLine.findUniqueOrThrow({ where: { id } })).version });
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, buyerIds: [actor.id], purchaseApproverIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: '隔离采购改版验收' });
  const names = ['下内刀','下外刀','上外刀','上内刀','备件套','定位销','紧固件'].map(n => `${n} ${fixture.marker}`);
  const request = await run({ action: 'SAVE_REQUEST', submit: true, purpose: fixture.marker, lines: names.map(name => ({ name, spec: 'M8 / 标准件', quantity: 2, unit: '件', estimateCents: 10000, needDate: fixture.date })) });
  const ids = request.lineIds as string[];
  await run({ action: 'APPROVE_LINES', entries: await Promise.all(ids.map(entry)) });
  const fundIds: string[] = [];
  for (const [selection, settlement] of [[ids.slice(0,3),'CORPORATE'],[ids.slice(3,5),'MONTHLY']] as const) {
    await run({ action: 'PURCHASE', entries: await Promise.all(selection.map(async id => ({ ...await entry(id), unitPrice: '50', actualCents: 10000 }))), settlement, supplier: '刀具供应商 ' + fixture.marker, payee: '刀具收款人 ' + fixture.marker, bank: '验收银行', account: 'TEST-271', eta: fixture.date, cycle: fixture.date.slice(0,7), dueDate: fixture.date });
    const fund = await run({ action: 'CREATE_FUND', entries: await Promise.all(selection.map(entry)), amountCents: selection.length * 10000, adjustment: 'NONE' });
    const f = await prisma.pcFund.findUniqueOrThrow({ where: { id: String(fund.id) } });
    await run({ action: 'APPROVE_FUNDS', id: f.id, version: f.version }); fundIds.push(f.id);
  }
  const week = naturalProductionWeek();
  for (const pool of [false,true]) for (const [index, label] of ['采购缺料','客供缺料','数量未知','尚未核对'].entries()) {
    const code = `${fixture.marker}-${pool ? 'POOL' : 'WEEK'}-${index}`;
    const source = pool ? await prisma.productionPlanOrder.create({ data: { sourceOrderNo: code, sourceLineNo: 1, productName: label, specification: code, customerName: '验收客户', orderQuantity: 10, orderDate: new Date(), customerDueDate: new Date(Date.now() + 86400000) } }) : await prisma.workOrder.create({ data: { code, productName: label, specification: code, customerName: '验收客户', stage: 'not_issued', productionTargetQty: 10, planType: 'weekly_plan', planActive: true, weekStartDate: week.start, weekEndDate: week.end } });
    const task = await prisma.warehouseMaterialTask.create({ data: { ...(pool ? { planOrderId: source.id } : { workOrderId: source.id }), status: index === 3 ? 'pending' : 'exception' } });
    if (index < 3) await prisma.warehouseMaterialExceptionCase.create({ data: { warehouseTaskId: task.id, sequence: 1, exceptionType: 'shortage', exceptionNote: label, materialModel: `${label}物料`, supplySource: ['PURCHASED','CUSTOMER','UNKNOWN'][index], shortageQuantity: index === 2 ? null : 10 } });
    if (index === 1) await prisma.warehouseMaterialExceptionCase.create({ data: { warehouseTaskId: task.id, sequence: 2, exceptionType: 'shortage', exceptionNote: '已解决的采购缺料', materialModel: '历史采购料', supplySource: 'PURCHASED', status: 'RESOLVED', shortageQuantity: 2, receivedQuantity: 2, resolvedAt: new Date() } });
  }
  const lines = await prisma.pcLine.findMany({ where: { id: { in: ids } }, select: { id:true,number:true,name:true }, orderBy: { number:'asc' } });
  const output = process.env.PURCHASING_IMPROVEMENTS_FIXTURE || 'output/playwright/purchasing-improvements/fixture.json';
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ ...fixture, lines, fundIds }, null, 2));
  console.log('Disposable purchasing and shortage fixtures saved.');
}
main().finally(() => prisma.$disconnect());
