import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { emptyQualityForm, type QualityRecord } from '../lib/quality-data';
import { createQualityRecord, loadQualityRecord, mutateQualityRecord, qualityFirstOverview } from '../lib/quality-data-service';
import { firstOrderList, firstRecordList } from '../lib/quality-first-service';
import { qualityWorkbook } from '../lib/quality-data-export';

test('first inspections remain discoverable across completion, upload dates, historical steps and pagination', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const marker = 'first-search-' + randomUUID();
  const actor = { id: marker, name: '首件验收员', canManage: true, canReview: true };
  const ids: string[] = [], orderIds: string[] = [];
  const params = (extra: Record<string, string> = {}) => new URLSearchParams({ q: marker, period: 'all', ...extra });
  const week = new Date('2026-09-20T16:00:00Z');
  const orders = await Promise.all(Array.from({ length: 25 }, (_, i) => prisma.workOrder.create({ data: {
    code: marker + '-' + i, productName: '同型号不同工单', specification: marker, customerName: '首件测试客户', stage: 'frontend', weekStartDate: week, planActive: false,
    processRoute: { create: { templateName: '首件测试工艺', templateVersion: 1, steps: { create: [1, 2].map(position => ({ position, sequenceGroup: position, processCode: 'P' + position, processName: position === 1 ? '压接' : '包装', stageGroup: 'frontend', standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '件', standardMillisecondsPerUnit: 1000 })) } } },
  }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } })));
  orderIds.push(...orders.map(o => o.id));
  // Seed the old order-bound format directly; the public create API now rejects these links.
  const create = async (n: number) => {
    const r = await createQualityRecord(actor, { type: 'FIRST', title: marker, inspectedAt: '2026-09-10T09:00', data: { ...emptyQualityForm('FIRST', actor.name), mode:'FILE', rows:[] }, idempotencyKey:randomUUID() }); ids.push(r.id);
    const step=orders[n].processRoute!.steps[0];
    await prisma.qualityDataRecord.update({where:{id:r.id},data:{workOrderId:orders[n].id,inspectionStepId:step.id,inspectionStepSnapshot:{id:step.id,position:step.position,name:step.processName},orderSnapshot:{...r.orderSnapshot,id:orders[n].id,code:orders[n].code,specification:marker},data:{...r.data,paper:{result:'FAIL',area:'',archive:false}} as never}});
    return loadQualityRecord(r.id);
  };
  const attach = async (record: QualityRecord, createdAt: string, by = actor.id) => { await prisma.qualityDataAttachment.create({ data: { recordId: record.id, originalName: '可搜索首件凭证.png', objectKey: marker + '/' + randomUUID(), sha256: randomUUID().replaceAll('-', '').repeat(2), size: 100, mimeType: 'image/png', createdAt: new Date(createdAt), createdById: by } }); return loadQualityRecord(record.id); };
  try {
    let first = await attach(await create(0), '2026-09-12T04:00:00Z');
    const draft = await attach(await create(1), '2026-09-13T04:00:00Z');
    const submit = (r: QualityRecord) => mutateQualityRecord(r.id, actor, { action: 'SUBMIT', version: r.version, title: r.title, inspectedAt: r.inspectedAt, data: r.data });
    first = await submit(first);
    assert.equal(first.result, 'FAIL');
    let list = await firstOrderList(params(), actor.id);
    assert.deepEqual(list.counts, { all: 25, done: 1, todo: 24 });
    assert.equal(list.items.length, 20);
    const secondPage = await firstOrderList(params({ page: '2' }), actor.id);
    assert.equal(secondPage.items.length, 5);
    assert.equal(new Set([...list.items, ...secondPage.items].map(o => o.id)).size, 25);
    assert.deepEqual((await firstOrderList(params({ completion: 'DONE' }), actor.id)).items.map(o => o.id), [orders[0].id]);
    assert.ok((await firstOrderList(params({ completion: 'TODO' }), actor.id)).items.some(o => o.id === orders[1].id));
    assert.equal((await firstOrderList(params({ week: '2026-09-21' }), actor.id)).total, 25);
    assert.equal((await firstOrderList(params({ week: '2026-09-14' }), actor.id)).total, 0);
    assert.equal((await firstOrderList(params({ completion: 'TODO', period: 'today', date: '2026-01-01' }), actor.id)).total, 24);
    // Historical online rows count as registered even when they have no attachment.
    const legacy = await create(2);
    await prisma.qualityDataRecord.update({ where: { id: legacy.id }, data: { status: 'SUBMITTED', result: 'PASS', submittedAt: new Date(), inspectionStepId: null, data: { ...legacy.data, mode: 'FORM' } as never } });
    assert.equal((await firstOrderList(params(), actor.id)).counts.done, 2);
    const old = (await firstRecordList(params({ workOrderId: orders[2].id, step: 'legacy' }), actor.id)).items[0];
    assert.equal(old.id, legacy.id); assert.equal(old.activity.firstUploadedAt, null);
    // A deleted process must not make its attached records disappear.
    await prisma.workOrderProcessStep.delete({ where: { id: orders[0].processRoute!.steps[0].id } });
    assert.ok((await qualityFirstOverview(orders[0].id)).steps.some(s => s.retired));
    assert.equal((await firstRecordList(params({ workOrderId: orders[0].id }), actor.id)).items[0].id, first.id);
    let timeline = (await firstRecordList(params({ recordId: first.id }), actor.id)).items[0];
    assert.equal(timeline.activity.firstUploadedAt, '2026-09-12T04:00:00.000Z');
    assert.equal(timeline.activity.lastUploadedAt, '2026-09-12T04:00:00.000Z');
    assert.notEqual(timeline.activity.lastUploadedAt, timeline.inspectedAt);
    await attach(first, '2026-09-18T07:10:00Z', actor.id + '-other');
    timeline = (await firstRecordList(params({ recordId: first.id }), actor.id)).items[0];
    assert.equal(timeline.activity.lastUploadedAt, '2026-09-18T07:10:00.000Z');
    assert.equal(timeline.activity.firstUploadedAt, '2026-09-12T04:00:00.000Z');
    assert.equal((await firstRecordList(params({ period: 'today', date: '2026-09-18' }), actor.id)).total, 1);
    assert.equal((await firstRecordList(params({ period: 'today', date: '2026-09-10', timeField: 'inspectedAt' }), actor.id)).total, 3);
    assert.equal((await firstRecordList(params({ mine: '1' }), actor.id + '-other')).items[0].id, first.id);
    assert.equal((await firstRecordList(params({ mine: '1' }), 'unrelated')).total, 0);
    assert.equal((await firstRecordList(params({ result: 'FAIL', completion: 'DONE' }), actor.id)).items[0].id, first.id);
    const pinned = await firstRecordList(params({ completion: 'TODO', recordId: first.id }), actor.id);
    assert.equal(pinned.items[0].id, first.id);
    first = await loadQualityRecord(first.id);
    first = await mutateQualityRecord(first.id, actor, { action: 'DELETE', version: first.version, reason: '测试作废' });
    assert.equal((await firstOrderList(params(), actor.id)).counts.done, 1);
    assert.equal((await firstRecordList(params({ deleted: '1' }), actor.id)).items[0].id, first.id);
    await mutateQualityRecord(first.id, actor, { action: 'RESTORE', version: first.version, reason: '测试恢复' });
    assert.equal((await firstOrderList(params(), actor.id)).counts.done, 2);
    assert.equal((await firstRecordList(params({ draft: '1' }), actor.id)).items[0].id, draft.id);
    const workbook = new ExcelJS.Workbook();
    const exported = await firstRecordList(params({ mine: '1' }), actor.id + '-other', true);
    await workbook.xlsx.load(await qualityWorkbook(exported.items, '我上传的') as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('记录清单')!;
    assert.equal(sheet.rowCount, 4);
    assert.ok(JSON.stringify(sheet.getRow(3).values).includes('首次上传时间'));
    assert.ok(JSON.stringify(sheet.getRow(4).values).includes('2026/09/12'));
    await assert.rejects(firstOrderList(params({ week: 'invalid' }), actor.id), /计划周日期无效/);
  } finally {
    await prisma.qualityDataRevision.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataAttachment.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataRecord.deleteMany({ where: { id: { in: ids } } });
    await prisma.workOrderProcessStep.deleteMany({ where: { routeId: { in: orders.map(o => o.processRoute!.id) } } });
    await prisma.workOrderProcessRoute.deleteMany({ where: { workOrderId: { in: orderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
});
