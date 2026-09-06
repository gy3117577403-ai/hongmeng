import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityEventTitle, qualityWorkflowView, qualityMyPending, qualityDate } from '../lib/quality-workbench';
import { qualityTaskDeadline } from '../lib/quality-workflow-v3';
const task = (status: string, id = 'lead') => ({ id, status, ownerUserId: id, ownerName: id, dueAt: '2026-09-05T15:59:59.999Z' });
const report = (statuses: string[], status = 'COLLABORATING') => ({ status, ownerUserId: 'lead', reviewerUserId: 'quality', tasks: statuses.map((s, i) => task(s, i === 0 ? 'lead' : 'worker')) });
test('display stage distinguishes partial acceptance, consolidation, verification and archived facts', () => {
  assert.equal(qualityWorkflowView(report(['TODO', 'CANCELLED'])).phase, 'SUBMITTED');
  assert.equal(qualityWorkflowView(report(['TODO', 'IN_PROGRESS'])).phase, 'COLLABORATING');
  assert.equal(qualityWorkflowView(report(['COMPLETED', 'TODO'])).unaccepted, 1);
  assert.equal(qualityWorkflowView(report(['COMPLETED', 'VERIFIED', 'CANCELLED'])).phase, 'SUMMARIZING');
  for (const status of ['DRAFT', 'VERIFYING', 'PENDING_CLOSE', 'ARCHIVED']) assert.equal(qualityWorkflowView(report(['COMPLETED'], status)).phase, status);
  assert.equal(qualityWorkflowView(report([])).phase, 'COLLABORATING');
  assert.equal(qualityWorkflowView(report(['CANCELLED'])).activeTasks, 0);
  assert.equal(qualityWorkflowView(report(['CANCELLED'])).phase, 'COLLABORATING');
});
test('pending ownership moves to lead then independent quality and stops after confirmation', () => {
  const allDone = report(['COMPLETED', 'COMPLETED']);
  assert.equal(qualityMyPending(allDone, 'lead'), true);
  assert.equal(qualityMyPending(allDone, 'worker'), false);
  assert.equal(qualityMyPending({ ...allDone, status: 'VERIFYING' }, 'quality'), true);
  assert.equal(qualityMyPending({ ...allDone, status: 'PENDING_CLOSE' }, 'quality'), false);
  assert.equal(qualityMyPending({ ...allDone, deletedAt: new Date() }, 'lead'), false);
});
test('deadlines use Beijing end of day and exclude submitted or frozen tasks', () => {
  assert.equal(qualityWorkflowView(report(['TODO', 'COMPLETED']), new Date('2026-09-05T15:59:59Z')).overdueTasks, 0);
  assert.equal(qualityWorkflowView(report(['TODO', 'COMPLETED']), new Date('2026-09-05T16:00:00Z')).overdueTasks, 1);
  assert.equal(qualityWorkflowView(report(['TODO'], 'ARCHIVED'), new Date('2026-09-06')).overdueTasks, 0);
  assert.equal(qualityDate(qualityTaskDeadline('2028-02-29')), '2028-02-29');
  assert.equal(qualityTaskDeadline('2026-09-06')!.toISOString(), '2026-09-06T15:59:59.999Z');
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', 'tomorrow', 12]) assert.throws(() => qualityTaskDeadline(value));
  assert.equal(qualityTaskDeadline(''), null);
});
test('titles make old category-only records recognizable without rewriting history', () => {
  assert.equal(qualityEventTitle({ title: '工艺问题', defectPhenomenon: '图纸与指导书\n要求不一致' }), '图纸与指导书 要求不一致');
  assert.equal(qualityEventTitle({ title: '客户指定的标题', defectPhenomenon: '事实' }), '客户指定的标题');
});
