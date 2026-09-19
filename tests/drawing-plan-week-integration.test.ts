import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { drawingPlanWeekScope } from '../lib/drawing-plan-week';
import { mutateQualityFixture } from '../lib/quality-fixture-service';
import { loadQualityFixtures } from '../lib/quality-fixture-queries';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
test('drawing plan weeks preserve product identity, empty documents, week cohorts and concurrent fixture choices', { skip: !enabled }, async t => {
  const prefix = 'WEEK-' + randomUUID().slice(0, 8);
  const actor = await prisma.user.create({ data: { username: prefix, displayName: '周筛选验收', passwordHash: 'test-only', laborRole: 'ADMIN' } });
  const make = async (name: string, weeks: string[], state = 'draft', orderStatus = 'pending', deleted = false) => {
    const product = await prisma.drawingLibraryItem.create({ data: { customerName: prefix, specification: prefix + name, libraryKey: prefix + name, fixtureRequired: null } });
    await prisma.productionPlanOrder.create({ data: { sourceOrderNo: prefix + name, sourceLineNo: 1, customerName: prefix, productName: name, specification: product.specification, drawingLibraryItemId: product.id, orderQuantity: weeks.length, orderDate: new Date('2026-08-01'), customerDueDate: new Date('2026-10-01'), status: orderStatus,
      batches: { create: weeks.map((week, i) => ({ batchNo: i + 1, quantity: 1, weekStartDate: new Date(week + 'T00:00:00+08:00'), weekEndDate: new Date(week + 'T00:00:00+08:00'), plannedCompletionDate: new Date(week + 'T00:00:00+08:00'), releaseState: state, deletedAt: deleted ? new Date() : null })) } } });
    return product;
  };
  const thisWeek = await make('-THIS', ['2026-09-14']);
  const shared = await make('-SHARED', ['2026-09-14', '2026-09-21', '2026-09-21']);
  const empty = await make('-EMPTY', ['2026-09-21']);
  const completed = await make('-COMPLETE', ['2026-09-21'], 'active', 'completed');
  await make('-CANCELLED', ['2026-09-21'], 'draft', 'cancelled');
  await make('-ARCHIVED', ['2026-09-21'], 'archived');
  await make('-CANCELLED-ORDER', ['2026-09-21'], 'draft', 'cancelled');
  await make('-DELETED', ['2026-09-21'], 'draft', 'pending', true);
  const get = (week: string) => prisma.drawingLibraryItem.findMany({ where: { customerName: prefix, AND: [drawingPlanWeekScope(week)] }, orderBy: { id: 'asc' } });
  await t.test('week is based on plan week, includes empty and completed products, deduplicates multiple batches and excludes cancellations', async () => {
    assert.deepEqual(new Set((await get('2026-09-14')).map(p => p.id)), new Set([thisWeek.id, shared.id]));
    assert.deepEqual(new Set((await get('2026-09-23')).map(p => p.id)), new Set([shared.id, empty.id, completed.id]));
    assert.equal(await prisma.drawingLibraryFile.count({where:{libraryItemId:empty.id}}), 0);
    assert.equal((await get('2026-09-28')).length, 0);
  });
  await t.test('the old week stays outside review even when the product also has a new governed batch', async () => {
    const old = await loadQualityFixtures(new URLSearchParams({view:'review',week:'2026-09-14',q:prefix}), actor);
    assert.equal(old.total, 0);
    const future = await loadQualityFixtures(new URLSearchParams({view:'review',week:'2026-09-21',q:prefix}), actor);
    assert.deepEqual(new Set(future.products.map(p=>p.id)), new Set([shared.id,empty.id]));
  });
  await t.test('concurrent fixture changes cannot silently overwrite a newer choice', async () => {
    await mutateQualityFixture({action:'SET_REQUIREMENT',productIds:[empty.id],needFixture:true,expectedNeedFixture:null}, actor, randomUUID());
    await assert.rejects(() => mutateQualityFixture({action:'SET_REQUIREMENT',productIds:[empty.id],needFixture:false,expectedNeedFixture:null}, actor, randomUUID()), /其他人更新/);
    assert.equal((await prisma.drawingLibraryItem.findUniqueOrThrow({where:{id:empty.id}})).fixtureRequired, true);
    const prepared = await loadQualityFixtures(new URLSearchParams({view:'plans',week:'2026-09-21',q:prefix}), actor);
    assert.equal(prepared.total, 1); assert.equal(prepared.product?.id, empty.id);
    await mutateQualityFixture({action:'SET_REQUIREMENT',productIds:[empty.id],needFixture:false,expectedNeedFixture:true}, actor, randomUUID());
    assert.equal((await loadQualityFixtures(new URLSearchParams({view:'plans',week:'2026-09-21',q:prefix}), actor)).total, 0);
    assert.equal((await loadQualityFixtures(new URLSearchParams({view:'review',week:'2026-09-21',q:prefix}), actor)).total, 2);
  });
});
test.after(async () => { await prisma.$disconnect(); });
