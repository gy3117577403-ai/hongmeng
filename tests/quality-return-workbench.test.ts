import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedReturns, replacementCandidates, returnCounts } from '../lib/quality-return-workbench';

test('pending technical work comes before saved and submitted replies without losing ready counts', () => {
  const issues = [{ id: 'saved', status: 'READY', createdAt: '2026-09-23' }, { id: 'closed', status: 'RESOLVED', createdAt: '2026-09-25' }, { id: 'open', status: 'OPEN', createdAt: '2026-09-21' }, { id: 'review', status: 'REVIEWING', createdAt: '2026-09-24' }];
  assert.deepEqual(orderedReturns(issues).map(i => i.id), ['open', 'saved', 'review', 'closed']);
  assert.deepEqual(returnCounts(issues), { open: 1, ready: 1, reviewing: 1, resolved: 1, active: 3 });
  assert.equal(issues[0].id, 'saved', 'sorting does not mutate the response');
});
test('replacement selector follows the original file through deleted ancestors and excludes unrelated SOPs', () => {
  const file = (id: string, supersedesFileId: string | null, isCurrent = true, deletedAt: string | null = null) => ({ id, supersedesFileId, isCurrent, deletedAt, category: { code: 'sop' } });
  const files = [file('old', null, false, '2026-09-20'), file('middle', 'old', false, '2026-09-21'), file('new', 'middle'), file('unrelated', null), { ...file('drawing', 'old'), category: { code: 'drawing' } }, file('deletedCurrent', 'middle', true, '2026-09-22')];
  assert.deepEqual(replacementCandidates(files, { fileId: 'old', kind: 'sop' }).map(f => f.id), ['new']);
  assert.deepEqual(replacementCandidates(files, { fileId: null, kind: 'package' }).map(f => f.id), ['new', 'unrelated', 'drawing']);
  assert.deepEqual(replacementCandidates([file('cycle-a', 'cycle-b'), file('cycle-b', 'cycle-a')], { fileId: 'absent', kind: 'sop' }), []);
});
