import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { mutatePurchasing } from '../lib/purchasing-service';
import { loadPurchasing, purchasingFundsForExport } from '../lib/purchasing-queries';
import { buildPurchasingFundWorkbook } from '../lib/purchasing-export';
import type { PcInput } from '../lib/purchasing-domain';

test('execution partitions, exact financial workbook, snapshot and partial-payment acceptance', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const marker = 'finance271-' + randomUUID(), date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const actor = await prisma.user.create({ data: { username: marker, displayName: marker, passwordHash: 'not-a-login', laborRole: 'ADMIN' } });
  const run = (input: PcInput) => mutatePurchasing(input, actor, randomUUID()) as Promise<Record<string, unknown>>;
  const line = (id: string) => prisma.pcLine.findUniqueOrThrow({ where: { id } });
  const entry = async (id: string) => ({ id, version: (await line(id)).version });
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, purchaseApproverIds: [actor.id], buyerIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: '隔离财务导出验收' });
  const created = await run({ action: 'SAVE_REQUEST', submit: true, purpose: marker, lines: Array.from({ length: 6 }, (_, i) => ({ name: `${marker}-物品${i + 1}`, spec: 'M8', unit: '件', quantity: 2, estimateCents: 10000, needDate: date })) });
  const ids = created.lineIds as string[];
  await run({ action: 'APPROVE_LINES', entries: await Promise.all(ids.map(entry)) });
  const purchase = async (selected: string[], settlement: string) => run({ action: 'PURCHASE', settlement, supplier: marker, payee: marker, bank: '验收银行', account: 'TEST-271', eta: date, cycle: date.slice(0, 7), dueDate: date,
    entries: await Promise.all(selected.map(async id => ({ ...await entry(id), unitPrice: id === ids[0] ? '49.5' : '50', freightCents: id === ids[0] ? 200 : 0, discountCents: id === ids[0] ? 100 : 0, actualCents: 10000 }))) });
  await purchase(ids.slice(0, 3), 'CORPORATE');
  await purchase(ids.slice(3, 5), 'MONTHLY');
  await t.test('database rejects partially populated or inconsistent pricing', async () => {
    await assert.rejects(prisma.pcLine.update({ where: { id: ids[0] }, data: { goodsCents: null } }), /PcLine_pricing_check/);
    await assert.rejects(prisma.pcLine.update({ where: { id: ids[0] }, data: { unitPrice: null } }), /PcLine_pricing_check/);
    await assert.rejects(prisma.pcLine.update({ where: { id: ids[0] }, data: { freightCents: 300 } }), /PcLine_pricing_check/);
  });
  const query = { q: marker, view: 'execution' };
  await t.test('one request splits by line, stage totals and filters cover all pages', async () => {
    const pending = await loadPurchasing(query, actor), ordered = await loadPurchasing({ ...query, executionStage: 'ordered', pageSize: 2 }, actor), all = await loadPurchasing({ ...query, executionStage: 'all' }, actor);
    assert.deepEqual(pending.rows.map(r => r.id), [ids[5]]);
    assert.deepEqual(pending.executionCounts, { pending: 1, ordered: 5, all: 6 });
    assert.equal(pending.counts.execution, 6);
    assert.equal(ordered.rows.length, 2); assert.equal(ordered.total, 5); assert.equal(ordered.totalCents, 50000);
    assert.equal(all.total, 6); assert.equal(all.totalCents, 60000);
    assert.equal((await loadPurchasing({ ...query, executionStage: 'ordered', settlement: 'MONTHLY' }, actor)).total, 2);
    await assert.rejects(loadPurchasing({ ...query, executionStage: 'bogus' }, actor), /分类无效/);
  });
  const fund = async (selected: string[], amountCents: number, adjustment = 'NONE') => {
    const f = await run({ action: 'CREATE_FUND', entries: await Promise.all(selected.map(entry)), amountCents, adjustment, reason: '验收差额' });
    const saved = await prisma.pcFund.findUniqueOrThrow({ where: { id: String(f.id) } });
    await run({ action: 'APPROVE_FUNDS', id: saved.id, version: saved.version });
    return saved.id;
  };
  const fundIds = [await fund(ids.slice(0, 3), 30000), await fund(ids.slice(3, 5), 20000)];
  const exportRows = () => purchasingFundsForExport({ view: 'finance', ids: fundIds, follow: 'history' }, actor);
  const workbook = async () => { const book = buildPurchasingFundWorkbook(await exportRows(), marker); const parsed = new ExcelJS.Workbook(); await parsed.xlsx.load(await book.xlsx.writeBuffer()); return parsed; };
  await t.test('two funds produce two summaries and five item rows with accurate unit prices and 500 total', async () => {
    const book = await workbook(), s = book.getWorksheet('付款汇总')!, d = book.getWorksheet('采购明细')!;
    assert.equal(s.rowCount, 3); assert.equal(d.rowCount, 6);
    assert.equal(Number(s.getCell('E2').value) + Number(s.getCell('E3').value), 500);
    const detailRows = Array.from({ length: 5 }, (_, i) => d.getRow(i + 2));
    assert.equal(detailRows.reduce((n, r) => n + Number(r.getCell(16).value), 0), 500);
    assert.ok(detailRows.every(r => r.getCell(7).value === 2 && r.getCell(19).value === '已批准 / 待付款'));
    assert.ok(detailRows.some(r => r.getCell(9).value === 49.5 && r.getCell(11).value === 99 && r.getCell(12).value === 2 && r.getCell(13).value === 1));
    assert.equal((await purchasingFundsForExport({ view: 'finance', ids: [fundIds[1]] }, actor)).length, 1);
    assert.equal((await purchasingFundsForExport({ view: 'finance', q: marker, settlement: 'MONTHLY' }, actor)).length, 1);
  });
  await t.test('a fund retains the original name, quantity and price snapshot', async () => {
    await prisma.pcLine.update({ where: { id: ids[0] }, data: { name: '之后更名', quantity: 4, unitPrice: '24.75' } });
    const book = await workbook(), sheet = book.getWorksheet('采购明细')!;
    const row = Array.from({ length: 5 }, (_, i) => sheet.getRow(i + 2)).find(r => r.getCell(5).value === `${marker}-物品1`)!;
    assert.ok(row); assert.equal(row.getCell(7).value, 2); assert.equal(row.getCell(9).value, 49.5); assert.equal(row.getCell(21).value, '资金申请时快照');
    await prisma.pcLine.update({ where: { id: ids[0] }, data: { name: `${marker}-物品1`, quantity: 2, unitPrice: '49.5' } });
  });
  const fundAction = async (action: string, id: string, extra: PcInput = {}) => run({ action, id, version: (await prisma.pcFund.findUniqueOrThrow({ where: { id } })).version, reason: '隔离测试', ...extra });
  await t.test('partial payments, closed balances and later requests reconcile without double counting', async () => {
    await fundAction('PAY', fundIds[0], { amountCents: 15000, date, source: '隔离账户', reference: randomUUID() });
    let book = await workbook(), sheet = book.getWorksheet('付款汇总')!;
    assert.equal([2, 3].reduce((n, row) => n + Number(sheet.getCell(`G${row}`).value), 0), 150);
    await fundAction('CLOSE_FUND', fundIds[0]);
    book = await workbook(); sheet = book.getWorksheet('付款汇总')!;
    const closed = [sheet.getRow(2), sheet.getRow(3)].find(r => r.getCell(9).value === '已关闭')!;
    assert.equal(closed.getCell(5).value, 300); assert.equal(closed.getCell(6).value, 150); assert.equal(closed.getCell(7).value, 150); assert.equal(closed.getCell(8).value, 0);
    const later = await fund(ids.slice(0, 3), 7500, 'PARTIAL');
    const row = buildPurchasingFundWorkbook(await purchasingFundsForExport({ view: 'finance', ids: [later] }, actor), marker).getWorksheet('付款汇总')!.getRow(2);
    assert.equal(row.getCell(5).value, 75); assert.equal(row.getCell(7).value, 0);
    await fundAction('WITHDRAW_FUND', later);
    const withdrawn = buildPurchasingFundWorkbook(await purchasingFundsForExport({ view: 'finance', ids: [later], follow: 'history' }, actor), marker).getWorksheet('付款汇总')!.getRow(2);
    assert.equal(withdrawn.getCell(5).value, 75); assert.equal(withdrawn.getCell(6).value, 0); assert.equal(withdrawn.getCell(8).value, 0);
  });
  await t.test('old records and snapshots are explicitly labeled as reconstructed prices', async () => {
    await run({ action: 'PURCHASE', entries: [{ ...await entry(ids[5]), actualCents: 4001 }], settlement: 'CORPORATE', supplier: marker, payee: marker, bank: '验收', account: 'TEST', eta: date });
    const oldId = await fund([ids[5]], 4001);
    const original = await prisma.pcFund.findUniqueOrThrow({ where: { id: oldId } });
    const snapshots = original.snapshot as Array<Record<string, unknown>>;
    await prisma.pcFund.update({ where: { id: oldId }, data: { snapshot: snapshots.map(s => ({ lineId: String(s.lineId), name: String(s.name), number: String(s.number), allocationCents: Number(s.allocationCents) })) } });
    const row = buildPurchasingFundWorkbook(await purchasingFundsForExport({ view: 'finance', ids: [oldId] }, actor), marker).getWorksheet('采购明细')!.getRow(2);
    assert.equal(row.getCell(9).value, 20.005); assert.match(String(row.getCell(10).value), /总额折算/); assert.equal(row.getCell(11).value, null); assert.match(String(row.getCell(21).value), /历史关联记录/);
  });
  await prisma.$disconnect();
});
