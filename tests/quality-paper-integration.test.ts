import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { emptyQualityForm, type QualityRecord } from '../lib/quality-data';
import { createQualityRecord, loadQualityRecord, mutateQualityRecord, listQualityRecords, qualityFirstOverview, qualityArchiveDays, qualityHistoricalRecord } from '../lib/quality-data-service';
import { deleteQualityFile } from '../lib/quality-data-files';
import { qualityWorkbook } from '../lib/quality-data-export';
import ExcelJS from 'exceljs';

test('paper archives preserve process identity, Shanghai dates, photo order and original evidence', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const marker = 'qpaper-' + randomUUID();
  const actor = { id: marker, name: '纸质检验验收', canManage: true, canReview: true };
  const worker = { ...actor, id: marker + '-worker', canManage: false, canReview: false };
  const order = await prisma.workOrder.create({ data: { code: marker, productName: '测试线束', specification: 'SAME-MODEL', stage: 'frontend', processRoute: { create: {
    templateName: '测试工艺', templateVersion: 1, status: 'in_progress', steps: { create: [1, 2, 3].map(position => ({ position, sequenceGroup: position, processCode: 'P' + position, processName: position === 3 ? '普通工序' : '首件检验', stageGroup: 'frontend', standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '套', standardMillisecondsPerUnit: 1000, inputQty: 20, status: 'pending' })) },
  } } }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  const other = await prisma.workOrder.create({ data: { code: marker + '-other', stage: 'frontend', productName: '测试线束', specification: 'SAME-MODEL' } });
  const steps = order.processRoute!.steps, ids: string[] = [];
  const form = (type: 'FIRST' | 'PATROL') => ({ ...emptyQualityForm(type, actor.name), mode: 'FILE' as const, rows: [], paper: { result: null as 'PASS' | 'FAIL' | 'PENDING' | null, area: '' } });
  const create = async (type: 'FIRST' | 'PATROL', extra: Record<string, unknown> = {}) => {
    const value = await createQualityRecord(worker, { title: marker, type, inspectedAt: '2026-09-15T00:30', data: form(type), idempotencyKey: randomUUID(), ...extra }); ids.push(value.id); return value;
  };
  const metadata = (r: QualityRecord) => ({ title: r.title, inspectedAt: r.inspectedAt, data: r.data, version: r.version });
  const addEvidence = async (r: QualityRecord, n: number) => {
    await prisma.qualityDataAttachment.createMany({ data: Array.from({ length: n }, (_, i) => ({ recordId: r.id, originalName: i + '.png', objectKey: marker + '/' + r.id + '/' + i, sha256: String(i).padStart(64, '0'), mimeType: 'image/png', size: 1, createdById: actor.id, sortOrder: i })) });
    return loadQualityRecord(r.id);
  };
  try {
    await assert.rejects(create('PATROL', { workOrderId: order.id }), /按日期归档/);
    await assert.rejects(create('PATROL', { sourceQrCode: 'anything' }), /按日期归档/);
    await assert.rejects(create('FIRST', { workOrderId: order.id }), /具体工序/);
    await assert.rejects(create('FIRST', { workOrderId: other.id, inspectionStepId: steps[0].id }), /不属于当前工单/);
    let first = await create('FIRST', { workOrderId: order.id, inspectionStepId: steps[0].id });
    assert.equal(first.inspectionStepSnapshot?.position, 1);
    assert.equal(first.data.context.processName, '首件检验');
    await assert.rejects(mutateQualityRecord(first.id, worker, { ...metadata(first), action: 'SUBMIT' }), /请选择本次首件检验结果/);
    first.data.paper!.result = 'FAIL';
    await assert.rejects(mutateQualityRecord(first.id, worker, { ...metadata(first), action: 'SUBMIT' }), /附件/);
    first = await addEvidence(first, 2); first.data.paper!.result = 'FAIL';
    first = await mutateQualityRecord(first.id, worker, { ...metadata(first), action: 'SUBMIT' });
    assert.equal(first.result, 'FAIL');
    const failedVersion = first.version;
    await assert.rejects(mutateQualityRecord(first.id, worker, { ...metadata(first), action: 'SAVE', reason: '错误切换', inspectionStepId: steps[1].id }), /不能更换/);
    await assert.rejects(mutateQualityRecord(first.id, { ...worker, id: 'other' }, { ...metadata(first), action: 'SAVE', reason: '越权' }), /本人/);
    const originalIds = first.attachments.map(file => file.id);
    first = await mutateQualityRecord(first.id, worker, { action: 'REORDER_ATTACHMENTS', attachmentIds: [...originalIds].reverse(), version: first.version, reason: '调整顺序' });
    assert.deepEqual(first.attachments.map(file => file.id), [...originalIds].reverse());
    await assert.rejects(mutateQualityRecord(first.id, worker, { action: 'REORDER_ATTACHMENTS', attachmentIds: originalIds, version: failedVersion, reason: '过期覆盖' }), /已被更新/);
    await assert.rejects(mutateQualityRecord(first.id, worker, { action: 'REORDER_ATTACHMENTS', attachmentIds: [originalIds[0], originalIds[0]], version: first.version, reason: '重复文件' }), /顺序已变化/);
    const second = await create('FIRST', { workOrderId: order.id, inspectionStepId: steps[1].id });
    let overview = await qualityFirstOverview(order.id);
    assert.equal(overview.steps.find(step => step.id === steps[0].id)?.result, 'FAIL');
    assert.equal(overview.steps.find(step => step.id === steps[1].id)?.result, null);
    assert.equal((await listQualityRecords(new URLSearchParams({ period: 'all', type: 'FIRST', inspectionStepId: steps[1].id }))).total, 1);
    assert.equal((await qualityFirstOverview(other.id)).steps.length, 0);
    await prisma.workOrderProcessStep.delete({ where: { id: steps[1].id } });
    overview = await qualityFirstOverview(order.id);
    assert.equal(overview.steps.find(step => step.id === steps[1].id)?.retired, true);
    assert.equal((await loadQualityRecord(second.id)).inspectionStepSnapshot?.position, 2);
    // Legacy identities remain unassigned, even when names exactly match a current step.
    await prisma.qualityDataRecord.update({ where: { id: second.id }, data: { inspectionStepId: null } });
    assert.equal((await qualityFirstOverview(order.id)).unassignedCount, 1);
    let patrol = await create('PATROL');
    assert.equal(patrol.workOrderId, null);
    patrol = await addEvidence(patrol, 1);
    patrol = await mutateQualityRecord(patrol.id, worker, { ...metadata(patrol), action: 'SUBMIT' });
    assert.equal(patrol.result, 'PENDING');
    await assert.rejects(deleteQualityFile(patrol.attachments[0].id, worker, { version: patrol.version, reason: '删除唯一凭证' }), /附件/);
    const beforeMidnight = await create('PATROL', { inspectedAt: '2026-09-14T23:30' });
    const dates = await qualityArchiveDays(new URLSearchParams({ period: 'month', date: '2026-09-15', q: marker }));
    assert.deepEqual(dates, [{ date: '2026-09-15', count: 1 }, { date: '2026-09-14', count: 1 }]);
    assert.equal((await listQualityRecords(new URLSearchParams({ period: 'all', scan: '1', q: marker }))).items.some(r => r.type === 'PATROL'), false);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await qualityWorkbook([first, patrol, beforeMidnight], '验收') as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    assert.equal(workbook.getWorksheet('巡检报表')!.rowCount, 3);
    assert.equal(workbook.getWorksheet('首件检验')!.rowCount, 2);
    const fileId = patrol.attachments[0].id;
    patrol = await mutateQualityRecord(patrol.id, actor, { action: 'DELETE', version: patrol.version, reason: '验收作废' });
    assert.ok(await prisma.qualityDataAttachment.findUnique({ where: { id: fileId } }));
    patrol = await mutateQualityRecord(patrol.id, actor, { action: 'RESTORE', version: patrol.version, reason: '验收恢复' });
    assert.equal(patrol.deletedAt, null);
    assert.equal((await qualityHistoricalRecord(first.id, failedVersion)).result, 'FAIL');
    assert.deepEqual((await qualityHistoricalRecord(first.id, failedVersion)).attachments.map(file => file.id), originalIds);
  } finally {
    await prisma.qualityDataRevision.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataAttachment.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.qualityDataRecord.deleteMany({ where: { id: { in: ids } } });
    await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute!.id } });
    await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute!.id } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [order.id, other.id] } } });
  }
});
