import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { loadPurchasing } from '../lib/purchasing-queries';
import { mutatePurchasing } from '../lib/purchasing-service';
import { pcReceiptState } from '../lib/purchasing-selection';
import type { PcInput } from '../lib/purchasing-domain';

test('cross-page reimbursement groups are atomic, idempotent, version checked and receipt filters match displayed facts', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.match(url.pathname, /(?:_ci|_test|_mirror)$/);
  const marker = 'PC284-' + randomUUID().slice(0, 8);
  const actor = await prisma.user.create({ data: { username: marker, displayName: '跨页采购验收', passwordHash: 'not-a-login', laborRole: 'ADMIN' } });
  const run = (input: PcInput, key = randomUUID()) => mutatePurchasing(input, actor, key) as Promise<any>;
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, purchaseApproverIds: [actor.id], buyerIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: '独立跨页验收' });
  try {
    const request = await prisma.pcRequest.create({ data: { number: marker, applicantId: actor.id, applicantName: '跨页采购验收', submitterId: actor.id, submitterName: '跨页采购验收', purpose: marker, status: 'SUBMITTED', lines: { create: Array.from({ length: 26 }, (_, i) => ({ number: `${marker}-${String(i).padStart(2, '0')}`, name: marker + '-物品' + i, spec: 'M5', unit: '件', category: '工具', needDate: '2026-10-23', quantity: 5, estimateCents: 500, actualCents: 500, payableCents: 500, status: 'ORDERED', settlement: 'ADVANCE', payee: i < 12 ? '收款人甲' : '收款人乙', payeeUserId: actor.id, bank: '验收银行', account: i < 12 ? 'A' : 'B', receivedQty: i === 24 ? 3 : i === 25 ? 5 : 0 })) } }, include: { lines: { orderBy: { number: 'asc' } } } });
    const first = await loadPurchasing({ q: marker, page: 1, pageSize: 12 }, actor), second = await loadPurchasing({ q: marker, page: 2, pageSize: 12 }, actor);
    assert.equal(first.total, 26); assert.equal(second.total, 26);
    assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 24);
    const all = await loadPurchasing({ q: marker, pageSize: 101 }, actor);
    assert.equal(all.rows.reduce((s, r) => s + r.availableCents, 0), 13000);
    for (const [state, count] of [['UNRECEIVED', 24], ['PARTIAL', 1], ['RECEIVED', 1]] as const) {
      const list = await loadPurchasing({ q: marker, receiptState: state, pageSize: 100 }, actor);
      assert.equal(list.total, count); assert.ok(list.rows.every(r => pcReceiptState(r).state === state));
    }
    const groups = [request.lines.slice(0, 12), request.lines.slice(12, 24)].map(lines => ({ entries: lines.map(l => ({ id: l.id, version: l.version })), amountCents: 6000 }));
    const before = await prisma.pcFund.count();
    await assert.rejects(() => run({ action: 'BATCH_CREATE_FUNDS', groups: [groups[0], { ...groups[1], amountCents: 1 }] }), /差额/);
    assert.equal(await prisma.pcFund.count(), before, 'second group failure rolls back first group');
    assert.equal((await prisma.pcLine.findUniqueOrThrow({ where: { id: request.lines[0].id } })).reservedCents, 0);
    await assert.rejects(() => run({ action: 'BATCH_CREATE_FUNDS', groups: [groups[0], groups[0]] }), /不能重复/);
    const stale = structuredClone(groups); stale[1].entries[0].version += 1;
    await assert.rejects(() => run({ action: 'BATCH_CREATE_FUNDS', groups: stale }), /已被更新/);
    assert.equal(await prisma.pcFund.count(), before);
    const key = randomUUID(), input = { action: 'BATCH_CREATE_FUNDS', groups };
    const result = await run(input, key); assert.equal(result.count, 2);
    assert.deepEqual(await run(input, key), result);
    const funds = await prisma.pcFund.findMany({ where: { id: { in: result.funds.map((f: {id:string}) => f.id) } }, include: { allocations: true } });
    assert.deepEqual(funds.map(f => f.amountCents), [6000, 6000]);
    assert.equal(funds.flatMap(f => f.allocations).length, 24);
    assert.equal(new Set(funds.map(f => f.account)).size, 2);
    assert.ok((await loadPurchasing({ q: marker, pageSize: 100 }, actor)).rows.filter(r => groups.flatMap(g => g.entries).some(e => e.id === r.id)).every(r => r.fundingIssue?.includes('无可申请余额')));
  } finally { await prisma.$disconnect(); }
});
