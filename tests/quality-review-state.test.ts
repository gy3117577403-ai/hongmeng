import test from 'node:test';
import assert from 'node:assert/strict';
import { documentReviewDecision } from '../lib/quality-review-state';
const draft = { id: 'new', status: 'DRAFT', sequence: 3, needFixture: false, drawingFiles: [{ id: 'drawing' }], sopFiles: [] };
const issue = { status: 'REVIEWING', submittedPackageId: 'old', responseText: '技术解释', responseFileId: 'drawing' };
test('complete documents never claim submittable while an old review holds the return', () => {
  assert.equal(documentReviewDecision(draft, [issue]).action, 'RECONCILE');
  assert.equal(documentReviewDecision(draft, [{ ...issue, status: 'READY' }]).action, 'RETURNS');
  assert.equal(documentReviewDecision(draft, [{ ...issue, status: 'READY' }], ['replacement']).state, 'RETURN_OPEN');
  assert.equal(documentReviewDecision(draft, []).action, 'SUBMIT');
});
test('historical and current pending records provide explicit destinations', () => {
  const history = documentReviewDecision({ ...draft, id: 'old', status: 'REVIEWING' }, [], undefined, 'new');
  assert.equal(history.action, 'CURRENT'); assert.equal(history.packageId, 'new');
  assert.equal(documentReviewDecision({ ...draft, status: 'QUALITY' }, [{ ...issue, submittedPackageId: 'new' }]).label, '待品质审核');
  assert.equal(documentReviewDecision({ ...draft, drawingFiles: [] }, []).action, 'EDIT');
});
