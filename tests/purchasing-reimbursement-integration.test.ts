import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { loadPurchasing, purchasingLookups, purchasingFundsForExport } from '../lib/purchasing-queries';
import { mutatePurchasing } from '../lib/purchasing-service';
import { buildPurchasingFundWorkbook } from '../lib/purchasing-export';
import type { PcInput } from '../lib/purchasing-domain';

test('single personal reimbursement: 49 historical purchases, identity, atomicity and lifecycle', { skip: process.env.RUN_DB_INTEGRATION !== '1', timeout: 120000 }, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /(?:_ci|_test|_mirror)$/.test(url.pathname));
  const marker = 'PC285-' + randomUUID().slice(0, 8), date = '2026-10-27';
  const actor = await prisma.user.create({ data: { username: marker, displayName: '报销验收', passwordHash: 'not-a-login', laborRole: 'ADMIN' } });
  const other = await prisma.user.create({ data: { username: marker + '-other', displayName: '其他垫付人', passwordHash: 'not-a-login' } });
  const run = (input: PcInput, key = randomUUID(), who = actor) => mutatePurchasing(input, who, key) as Promise<any>;
  const settings = await prisma.pcSettings.findUnique({ where: { id: 'purchasing' } });
  await run({ action: 'SAVE_SETTINGS', version: settings?.version, ownerId: actor.id, purchaseApproverIds: [actor.id], buyerIds: [actor.id], fundApproverIds: [actor.id], financeIds: [actor.id], reason: marker });
  const supplier = await prisma.pcSupplier.create({ data: { name: marker } });
  const makeRequest = (suffix: string, count: number, legacy = false) => prisma.pcRequest.create({ data: {
    number: marker + suffix, applicantId: actor.id, applicantName: actor.displayName!, submitterId: actor.id, submitterName: actor.displayName!, purpose: marker, status: 'SUBMITTED',
    lines: { create: Array.from({ length: count }, (_, i) => ({ number: `${marker}${suffix}-${i}`, name: `${marker} 物品${suffix}-${i}`, spec: 'M5', unit: '件', category: '工具', needDate: date, quantity: 5, estimateCents: 500, actualCents: 500, payableCents: 500, status: 'ORDERED', settlement: 'ADVANCE',
      supplierId: i % 2 ? supplier.id : null, payee: i % 3 ? '历史姓名' : '', payeeUserId: legacy || i % 7 === 0 ? null : actor.id,
      bank: i % 2 ? '旧银行' : '', account: i % 3 ? '旧卡-' + i : '0', receivedQty: i % 2 ? 5 : 0, dueDate: '2026-11-30', createdAt: new Date(Date.now() - i * 86400000),
    })) },
  }, include: { lines: { orderBy: { number: 'asc' } } } });
  const first = await makeRequest('-A', 25), second = await makeRequest('-B', 24), lines = [...first.lines, ...second.lines];
  const entries = lines.map(l => ({ id: l.id, version: l.version }));
  const input = { action: 'CREATE_REIMBURSEMENT', entries, amountCents: 24500, payeeUserId: actor.id, payee: '本次收款人', bank: '本次银行', account: '本次卡号', confirmLegacyPayee: true };
  const current = async (id: string) => { const l = await prisma.pcLine.findUniqueOrThrow({ where: { id } }); return { id, version: l.version }; };
  const countBefore = await prisma.pcFund.count();
  const unchanged = async () => {
    assert.equal(await prisma.pcFund.count(), countBefore);
    assert.equal(await prisma.pcLine.count({ where: { id: { in: lines.map(l => l.id) }, reservedCents: { not: 0 } } }), 0);
  };
  try {
    await t.test('five pages retain 49 available historical purchases', async () => {
      const pages = await Promise.all([1, 2, 3, 4, 5].map(page => loadPurchasing({ q: marker, page, pageSize: 12 }, actor)));
      assert.ok(pages.every(p => p.total === 49));
      assert.equal(new Set(pages.flatMap(p => p.rows.map(r => r.id))).size, 49);
      assert.equal(pages.flatMap(p => p.rows).reduce((s, r) => s + r.availableCents, 0), 24500);
    });
    await t.test('identity, incomplete account, invalid amounts, stale and repeated rows fail without partial writes', async () => {
      for (const [patch, expected] of [
        [{ confirmLegacyPayee: false }, /确认历史/], [{ payeeUserId: other.id }, /垫付人/],
        [{ account: '' }, /收款账户/], [{ bank: '0' }, /开户银行/], [{ amountCents: 0 }, /金额/], [{ amountCents: 24501 }, /余额/],
        [{ entries: [entries[0], entries[0]] }, /重复/], [{ entries: [{ ...entries[0], version: 999 }] }, /已被更新/],
      ] as [PcInput, RegExp][]) {
        await assert.rejects(run({ ...input, ...patch }), expected); await unchanged();
      }
      await assert.rejects(run(input, randomUUID(), other), /仅采购/); await unchanged();
    });
    await t.test('mixed people, currency, corporate, fixture, pending correction and refund guards apply on the server', async () => {
      const target = lines[1];
      for (const [data, expected] of [[{ payeeUserId: other.id }, /不同实际垫付人/], [{ currency: 'USD' }, /不同币种/], [{ settlement: 'CORPORATE' }, /不是个人垫付/]] as const) {
        await prisma.pcLine.update({ where: { id: target.id }, data });
        await assert.rejects(run(input), expected); await unchanged();
        await prisma.pcLine.update({ where: { id: target.id }, data: { payeeUserId: target.payeeUserId, currency: target.currency, settlement: target.settlement } });
      }
      await prisma.pcRequest.update({ where: { id: second.id }, data: { source: 'FIXTURE' } });
      await assert.rejects(run(input), /分别申请/); await unchanged();
      await prisma.pcRequest.update({ where: { id: second.id }, data: { source: 'NORMAL' } });
      const correction = await prisma.pcAmountCorrection.create({ data: { lineId: target.id, before: {}, after: {}, reason: marker, reviewRole: 'financeIds', actorId: actor.id, actorName: actor.displayName! } });
      await assert.rejects(run(input), /复核/); await unchanged();
      await prisma.pcAmountCorrection.update({ where: { id: correction.id }, data: { status: 'REJECTED' } });
      const returned = await prisma.pcReturn.create({ data: { number: marker, lineId: target.id, kind: 'UNRECEIVED', quantity: 1, amountCents: 100, refundDueCents: 100, reason: marker, date, destination: 'COMPANY', actorId: actor.id, actorName: actor.displayName! } });
      await assert.rejects(run(input), /退款/); await unchanged();
      await prisma.pcReturn.update({ where: { id: returned.id }, data: { refundedCents: 100, companyReceivedCents: 100 } });
    });
    const attachment = await prisma.pcAttachment.create({ data: { objectKey: 'isolated-test/' + randomUUID(), originalName: '统一报销凭证.pdf', contentType: 'application/pdf', size: 10, actorId: actor.id, actorName: actor.displayName! } });
    const submitted = { ...input, attachmentIds: [attachment.id] }, key = randomUUID();
    const result = await run(submitted, key);
    const fund = await prisma.pcFund.findUniqueOrThrow({ where: { id: result.id }, include: { allocations: true } });
    await t.test('one submission creates one BX fund, 49 allocations, one account and shared evidence', async () => {
      assert.equal(await prisma.pcFund.count(), countBefore + 1); assert.match(fund.number, /^BX/);
      assert.equal(fund.amountCents, 24500); assert.equal(fund.allocations.length, 49);
      assert.equal(fund.allocations.reduce((s, a) => s + a.amountCents, 0), 24500);
      assert.equal(fund.payeeUserId, actor.id); assert.equal(fund.account, '本次卡号'); assert.equal(fund.dueDate, '');
      assert.deepEqual(await run(submitted, key), result);
      await assert.rejects(run(submitted), /更新|余额/);
      assert.equal(await prisma.pcFund.count(), countBefore + 1);
      const file = await prisma.pcAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
      assert.equal(file.entityType, 'FUND'); assert.equal(file.entityId, fund.id);
      const snapshots = fund.snapshot as Record<string, unknown>[];
      assert.equal(snapshots.length, 49);
      assert.equal(snapshots.filter(s => s.legacyPayeeConfirmed).length, lines.filter(l => !l.payeeUserId).length);
      for (const original of lines) {
        const saved = await prisma.pcLine.findUniqueOrThrow({ where: { id: original.id } });
        for (const field of ['payeeUserId', 'payee', 'bank', 'account', 'receivedQty', 'actualCents', 'payableCents', 'invoiceCents', 'paidCents'] as const) assert.equal(saved[field], original[field], field);
        assert.equal(saved.reservedCents, 500);
      }
      const account = await purchasingLookups(new URLSearchParams({ type: 'reimbursement-account', payeeUserId: actor.id })) as any;
      assert.equal(account.account.account, '本次卡号');
      assert.equal((await purchasingLookups(new URLSearchParams({ type: 'reimbursement-account', payeeUserId: other.id })) as any).account, null);
    });
    await t.test('single approval, finance export, payment and source tracing still reconcile', async () => {
      await run({ action: 'APPROVE_FUNDS', id: fund.id, version: fund.version });
      const exported = await purchasingFundsForExport({ view: 'finance', ids: [fund.id] }, actor);
      const workbook = buildPurchasingFundWorkbook(exported, marker);
      assert.equal(workbook.getWorksheet('付款汇总')!.rowCount, 2);
      assert.equal(workbook.getWorksheet('采购明细')!.rowCount, 50);
      const approved = await prisma.pcFund.findUniqueOrThrow({ where: { id: fund.id } });
      await run({ action: 'PAY', id: fund.id, version: approved.version, amountCents: 24500, date, source: '隔离测试', reference: marker });
      const paid = await prisma.pcFund.findUniqueOrThrow({ where: { id: fund.id }, include: { payments: true } });
      assert.equal(paid.status, 'PAID'); assert.equal(paid.payments.length, 1); assert.equal(paid.paidCents, 24500);
    });
    await t.test('fully legacy records confirm once; partial claims retain the person and prevent double claiming', async () => {
      const legacy = await makeRequest('-legacy', 2, true);
      const ids = legacy.lines.map(l => l.id), legacyInput = { ...input, entries: await Promise.all(ids.map(current)), amountCents: 500 };
      const partial = await run(legacyInput);
      assert.equal((await prisma.pcFund.findUniqueOrThrow({ where: { id: partial.id } })).adjustment, 'PARTIAL');
      await assert.rejects(run({ ...legacyInput, entries: await Promise.all(ids.map(current)), payeeUserId: other.id }), /垫付人/);
      const remainder = { ...legacyInput, entries: await Promise.all(ids.map(current)) };
      const outcomes = await Promise.allSettled([run(remainder), run(remainder)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const after = await prisma.pcLine.findMany({ where: { id: { in: ids } } });
      assert.ok(after.every(l => l.reservedCents === 500 && l.payeeUserId === null));
    });
    await t.test('an existing inactive advancing person can still be reimbursed', async () => {
      const request = await makeRequest('-inactive', 1);
      await prisma.pcLine.update({ where: { id: request.lines[0].id }, data: { payeeUserId: other.id } });
      await prisma.user.update({ where: { id: other.id }, data: { isActive: false } });
      const saved = await run({ ...input, entries: [await current(request.lines[0].id)], payeeUserId: other.id, amountCents: 500 });
      assert.equal((await prisma.pcFund.findUniqueOrThrow({ where: { id: saved.id } })).payeeUserId, other.id);
    });
  } finally { await prisma.$disconnect(); }
});
