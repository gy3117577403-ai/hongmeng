import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcessReportDraft, processReportDraftKey, PROCESS_REPORT_DRAFT_TTL, processReportReceiptText } from '../lib/process-report-draft';

const now = 1_800_000_000_000;
const draft = { version: 1, ownerId: 'employee-a', scope: 'mobile:code:route:step', value: { processedQty: '40', employeeIds: ['a'] }, idempotencyKey: 'report-1', savedAt: now };
test('draft identity is isolated by account, route and selected step', () => {
  assert.notEqual(processReportDraftKey('a', 'route:1'), processReportDraftKey('b', 'route:1'));
  assert.notEqual(processReportDraftKey('a:b', 'c'), processReportDraftKey('a', 'b:c'));
  assert.equal(parseProcessReportDraft(JSON.stringify(draft), 'employee-b', draft.scope, now), null);
  assert.equal(parseProcessReportDraft(JSON.stringify(draft), draft.ownerId, 'another-step', now), null);
  assert.deepEqual(parseProcessReportDraft(JSON.stringify(draft), draft.ownerId, draft.scope, now)?.value, draft.value);
});
test('ordinary drafts expire but unacknowledged submissions retain the original frozen request', () => {
  const old = { ...draft, savedAt: now - PROCESS_REPORT_DRAFT_TTL - 1 };
  assert.equal(parseProcessReportDraft(JSON.stringify(old), draft.ownerId, draft.scope, now), null);
  const queued = { ...old, request: { endpoint: '/api/field-report/tickets/code/completions', body: { idempotencyKey: draft.idempotencyKey, expectedUserId: draft.ownerId, processedQty: 40 } } };
  assert.equal(parseProcessReportDraft(JSON.stringify(queued), draft.ownerId, draft.scope, now)?.request?.body.processedQty, 40);
  assert.equal(parseProcessReportDraft(JSON.stringify({ ...queued, request: { ...queued.request, body: { ...queued.request.body, expectedUserId: 'b' } } }), draft.ownerId, draft.scope, now), null);
  assert.equal(parseProcessReportDraft(JSON.stringify({ ...queued, request: { ...queued.request, endpoint: 'https://example.com/collect' } }), draft.ownerId, draft.scope, now), null);
});
test('pending receipt never claims completion or earned labor', () => {
  const receipt = processReportReceiptText({ pending: true, submission: { id: 'SUB-1', reasonLabel: '续作周次待确认', assigneeNames: ['主管'] } });
  assert.match(receipt, /已申报待处理/);
  assert.match(receipt, /尚未计入正式报工和员工工时/);
  assert.match(receipt, /主管/);
  const recorded = processReportReceiptText({ pending: true, submission: { reasonCode: 'STANDARD_MISSING' } });
  assert.match(recorded, /数量已登记，工时待核定/);
  assert.doesNotMatch(recorded, /尚未计入正式报工/);
});
