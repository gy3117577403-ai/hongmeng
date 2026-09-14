import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './process-flexible-route-closure-integration.test';
import { prisma } from '../lib/prisma';
import { previewProductTimeDeployment, publishProductTimeDeployment } from '../lib/product-time-deployment-service';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function publish(f: Fixture, ids: number[], version: number) {
  const draft = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: f.item.id, version, status: 'draft', createdById: f.actor.id,
    entries: { create: ids.map((id, index) => ({ processDefinitionId: f.definitions[id].id, occurrenceKey: `operation-${id}`,
      position: index + 1, sequenceGroup: index + 1, timeBasis: 'per_unit', unitMilliseconds: 1000, occurrences: 1, unitLabel: '套' })) } } });
  if (process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN) {
    const { preview } = await f.api<{ preview: { canPublish: boolean; previewToken: string } }>(`/api/product-time-profiles/${f.item.id}/publish/preview`, {});
    assert.ok(preview.canPublish);
    return f.api(`/api/product-time-profiles/${f.item.id}/publish`, { expectedRevision: draft.revision, previewToken: preview.previewToken });
  }
  const preview = await previewProductTimeDeployment(f.item.id);
  assert.ok(preview.canPublish, JSON.stringify(preview.conflicts));
  const command = { itemId: f.item.id, actorId: f.actor.id, expectedRevision: draft.revision, previewToken: preview.previewToken };
  const result = await publishProductTimeDeployment(command);
  const replay = await publishProductTimeDeployment(command);
  assert.equal(result.deployment.id, replay.deployment.id, 'retry reuses the publication');
  return result;
}
for (const state of ['ACTIVE', 'FULFILLED', 'CANCELLED'] as const) {
  test(`supplement anchor ${state}: publish removal of an empty referenced step, retain evidence and report exact remaining quantity`, { skip: !enabled }, async () => {
    const f = await fixture([0, 1, 3, 4], 10);
    try {
      await f.report(0, 10);
      const anchor = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[3].id)!;
      assert.equal(anchor.inputQty, 0);
      await publish(f, [0, 1, 2, 3, 4], 2);
      const supplement = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[2].id)!;
      const obligationId = supplement.supplementObligation!.id;
      assert.equal(supplement.supplementObligation!.insertBeforeStepId, anchor.id);
      assert.equal(supplement.supplementObligation!.requiredQty, 10);
      if (state === 'FULFILLED') await f.report(2, 10);
      if (state === 'ACTIVE') await f.report(2, 3);
      if (state === 'CANCELLED') await prisma.processSupplementObligation.update({ where: { id: obligationId }, data: { status: 'CANCELLED' } });
      const completionsBefore = await prisma.processCompletion.count({ where: { routeId: f.routeId } });
      const laborBefore = await prisma.processLaborPool.aggregate({ where: { workOrderId: f.order.id }, _sum: { totalStandardLaborMilliseconds: true } });
      await publish(f, [0, 1, 2, 4], 3);
      const historicalAnchor = await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: anchor.id } });
      assert.ok(historicalAnchor.retiredAt, 'an obligation anchor is retired, never physically deleted');
      const obligation = await prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: obligationId } });
      const next = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[4].id)!;
      assert.equal(obligation.insertBeforeStepId, state === 'ACTIVE' ? next.id : anchor.id);
      assert.equal(obligation.status, state);
      assert.equal(await prisma.processCompletion.count({ where: { routeId: f.routeId } }), completionsBefore);
      assert.deepEqual(await prisma.processLaborPool.aggregate({ where: { workOrderId: f.order.id }, _sum: { totalStandardLaborMilliseconds: true } }), laborBefore);
      assert.equal(await prisma.processSupplementObligation.count({ where: { routeId: f.routeId } }), 1);
      if (state === 'ACTIVE') {
        assert.equal(obligation.reportedQty, 3); assert.equal(obligation.requiredQty, 10);
        await publish(f, [0, 1, 2], 4);
        assert.equal((await prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: obligationId } })).insertBeforeStepId, null);
        await f.report(2, 7);
        assert.equal((await prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: obligationId } })).reportedQty, 10);
      }
    } finally { await f.cleanup(); }
  });
}

test('supplement anchor: deleting obligation and its anchor together cancels the obligation without losing history', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 3, 4], 10);
  try {
    await f.report(0, 10); await publish(f, [0, 1, 2, 3, 4], 2);
    const supplement = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[2].id)!;
    const anchorId = supplement.supplementObligation!.insertBeforeStepId!;
    await publish(f, [0, 1, 4], 3);
    assert.ok((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: anchorId } })).retiredAt);
    assert.ok((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: supplement.id } })).retiredAt);
    assert.equal((await prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: supplement.supplementObligation!.id } })).status, 'CANCELLED');
  } finally { await f.cleanup(); }
});
