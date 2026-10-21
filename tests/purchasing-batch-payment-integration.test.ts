import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutatePurchasing, type PcActor } from '../lib/purchasing-service';
import { purchasingDetail } from '../lib/purchasing-queries';
import type { PcInput } from '../lib/purchasing-domain';

test('batch payments preserve individual accounting, shared receipts, atomicity and concurrency guards', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const marker = `BATCH-${randomUUID().slice(0, 8)}`;
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const actor = await prisma.user.create({ data: { username: marker, displayName: '批量付款验收', passwordHash: 'not-a-login-hash', laborRole: 'ADMIN' } });
  const other = await prisma.user.create({ data: { username: marker + '-other', displayName: '其他人员', passwordHash: 'not-a-login-hash' } });
  const run = (body: PcInput, key = randomUUID(), who: PcActor = actor) => mutatePurchasing(body, who, key) as Promise<Record<string, any>>;
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, reason: '独立验收', ownerId: actor.id, purchaseApproverIds: [actor.id], buyerIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id] });
  const currentFund = (id: string) => prisma.pcFund.findUniqueOrThrow({ where: { id } });
  const lineEntry = async (id: string) => ({ id, version: (await prisma.pcLine.findUniqueOrThrow({ where: { id } })).version });
  const make = async (amountCents: number) => {
    const request = await run({ action: 'SAVE_REQUEST', submit: true, purpose: marker, lines: [{ name: marker, spec: 'M8', unit: '件', quantity: 5, estimateCents: amountCents, needDate: date }] });
    const lineId = request.lineIds[0];
    await run({ action: 'APPROVE_LINES', entries: [await lineEntry(lineId)] });
    await run({ action: 'PURCHASE', entries: [{ ...await lineEntry(lineId), actualCents: amountCents }], supplier: marker, settlement: 'CORPORATE', payee: marker, bank: '验收银行', account: 'TEST-BATCH-01', eta: date });
    const f = await run({ action: 'CREATE_FUND', entries: [await lineEntry(lineId)], amountCents, adjustment: 'NONE' });
    await run({ action: 'APPROVE_FUNDS', entries: [{ id: f.id, version: (await currentFund(f.id)).version }] });
    return { id: String(f.id), lineId };
  };
  const entry = async (id: string, amountCents: number, reference = marker) => ({ id, version: (await currentFund(id)).version, amountCents, date, reference, source: '公司测试账户' });
  const staged = () => prisma.pcAttachment.create({ data: { entityType: 'STAGED', entityId: actor.id, objectKey: `test/${randomUUID()}`, originalName: '付款凭证.pdf', contentType: 'application/pdf', size: 8, actorId: actor.id, actorName: actor.displayName } });
  try {
    const a = await make(30000), b = await make(20000);
    const receipt = await staged(), individual = await staged();
    const key = randomUUID(), payload = { action: 'BATCH_PAY', entries: [await entry(a.id, 30000), { ...await entry(b.id, 10000), attachmentIds: [individual.id] }], attachmentIds: [receipt.id] };
    let result: Record<string, any>;
    await t.test('300 + 100 is 400, keeps 100 remaining, and links shared receipt to both funds and lines', async () => {
      result = await run(payload, key);
      assert.equal(result.totalCents, 40000); assert.equal(result.count, 2);
      assert.equal((await currentFund(a.id)).status, 'PAID');
      assert.equal((await currentFund(b.id)).status, 'PARTIAL');
      assert.equal((await currentFund(b.id)).paidCents, 10000);
      const payments = await prisma.pcPayment.findMany({ where: { batchId: result.id } });
      assert.equal(payments.length, 2); assert.equal(payments.reduce((s, p) => s + p.amountCents, 0), 40000);
      for (const f of [a, b]) {
        const d = await purchasingDetail(f.id, actor);
        assert.ok(d.attachments.some(file => file.id === receipt.id));
        const l = await purchasingDetail(f.lineId, actor);
        assert.ok(l.attachments.some(file => file.id === receipt.id));
      }
      assert.ok(!(await purchasingDetail(a.id, actor)).attachments.some(file => file.id === individual.id));
      assert.ok((await purchasingDetail(b.id, actor)).attachments.some(file => file.id === individual.id));
      const allocations = await prisma.pcFundAllocation.findMany({ where: { fundId: { in: [a.id, b.id] } } });
      assert.equal(allocations.reduce((s, row) => s + row.paidCents, 0), 40000);
    });
    await t.test('identical retry returns the same batch without duplicate payment', async () => {
      assert.deepEqual(await run(payload, key), result!);
      assert.equal(await prisma.pcPayment.count({ where: { batchId: result!.id } }), 2);
      await assert.rejects(run(payload), /本批次未登记|已被关联/);
      await assert.rejects(run({ ...payload, entries: [await entry(b.id, 10000)] }, key), /同一操作标识/);
    });
    const c = await make(20000);
    await t.test('a late invalid row rolls back earlier writes, batch, allocations and receipt binding', async () => {
      const file = await staged();
      const count = await prisma.pcPaymentBatch.count();
      await assert.rejects(run({ action: 'BATCH_PAY', entries: [await entry(c.id, 20000), await entry(b.id, 10001)], attachmentIds: [file.id] }), /超过/);
      assert.equal((await currentFund(c.id)).paidCents, 0);
      assert.equal(await prisma.pcPayment.count({ where: { fundId: c.id } }), 0);
      assert.equal(await prisma.pcPaymentBatch.count(), count);
      assert.equal((await prisma.pcAttachment.findUniqueOrThrow({ where: { id: file.id } })).entityType, 'STAGED');
    });
    await t.test('paid records, duplicate ids, invalid amounts and unauthorized actors cannot be registered', async () => {
      await assert.rejects(run({ action: 'BATCH_PAY', entries: [await entry(c.id, 20000), await entry(a.id, 1)] }), /只能登记已经批准/);
      const e = await entry(c.id, 20000);
      await assert.rejects(run({ action: 'BATCH_PAY', entries: [e, e] }));
      await assert.rejects(run({ action: 'BATCH_PAY', entries: [{ ...e, amountCents: 0 }] }));
      await assert.rejects(run({ action: 'BATCH_PAY', entries: [e] }, randomUUID(), other), /职责/);
      assert.equal((await currentFund(c.id)).paidCents, 0);
    });
    await t.test('concurrent submissions with separate keys register only once', async () => {
      const input = { action: 'BATCH_PAY', entries: [await entry(c.id, 20000), await entry(b.id, 10000)] };
      const runs = await Promise.allSettled([run(input), run(input)]);
      assert.equal(runs.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await currentFund(b.id)).paidCents, 20000);
      assert.equal((await currentFund(c.id)).paidCents, 20000);
    });
  } finally { await prisma.$disconnect(); }
});
