import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { qualityPhaseWhere, qualityWorkViewWhere } from '../lib/quality-workbench-query';
import { QUALITY_PHASE_LABELS, qualityWorkflowView, qualityMyPending } from '../lib/quality-workbench';
import { actOnQualityWorkflow } from '../lib/quality-workflow-v3';
test('PostgreSQL filters agree with display stages and zero active tasks cannot be submitted for review', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const prefix = 'qv4-' + randomUUID(), ids: string[] = [];
  const user = await prisma.user.create({ data: { username: prefix, displayName: '测试牵头', passwordHash: 'disposable-only' } });
  try {
    const rows = [];
    for (const status of ['DRAFT', 'SUBMITTED', 'COLLABORATING', 'VERIFYING', 'PENDING_CLOSE', 'REVISING', 'ARCHIVED']) {
      for (const statuses of [[], ['TODO', 'CANCELLED'], ['COMPLETED', 'IN_PROGRESS'], ['COMPLETED', 'VERIFIED'], ['CANCELLED']]) {
        const row = await prisma.internalQualityRiskReport.create({ data: { reportNo: prefix + '-' + ids.length, title: '工艺问题', status, ownerUserId: user.id, createdById: user.id, reviewerUserId: user.id, tasks: { create: statuses.map(status => ({ status, title: '任务', department: '工艺', ownerUserId: user.id })) } }, include: { tasks: true } });
        rows.push(row); ids.push(row.id);
      }
    }
    for (const phase of Object.keys(QUALITY_PHASE_LABELS)) {
      const actual = await prisma.internalQualityRiskReport.findMany({ where: { AND: [{ id: { in: ids } }, qualityPhaseWhere(phase)] }, select: { id: true } });
      assert.deepEqual(actual.map(r => r.id).sort(), rows.filter(r => qualityWorkflowView(r).phase === phase).map(r => r.id).sort(), phase);
    }
    const mine = await prisma.internalQualityRiskReport.findMany({ where: { AND: [{ id: { in: ids } }, qualityWorkViewWhere('MINE', user.id)] }, select: { id: true } });
    assert.deepEqual(mine.map(r => r.id).sort(), rows.filter(r => qualityMyPending(r, user.id)).map(r => r.id).sort());
    const empty = rows.find(r => r.status === 'COLLABORATING' && !r.tasks.length)!;
    await assert.rejects(prisma.$transaction(tx => actOnQualityWorkflow(tx, empty.id, empty.version, 'SUBMIT_REVIEW', { occurrenceCause: '原因', rootCause: '根因', finalConclusion: '结论', correctiveAction: '措施' }, { id: user.id, name: user.displayName })), /自动送品质确认/);
  } finally {
    await prisma.internalQualityRiskReport.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
