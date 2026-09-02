import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

test('field reporting submits a dedicated withdrawal request and can cancel the pending request', () => {
  const component = source('components/FieldReportMobile.tsx');
  const submitStart = component.indexOf('async function submitCorrection');
  const submitEnd = component.indexOf('async function cancelCorrectionRequest', submitStart);
  const cancelEnd = component.indexOf('async function submit()', submitEnd);
  assert.ok(submitStart >= 0 && submitEnd > submitStart && cancelEnd > submitEnd);

  const submit = component.slice(submitStart, submitEnd);
  const cancel = component.slice(submitEnd, cancelEnd);
  assert.match(submit, /method:\s*'POST'/);
  assert.match(submit, /expectedRouteVersion:\s*payload\.context\.routeVersion/);
  assert.match(submit, /status:\s*'REQUESTED'/);
  assert.doesNotMatch(submit, /WITHDRAWN|issue/);
  assert.match(cancel, /method:\s*'DELETE'/);
  assert.match(cancel, /requestId:\s*activeRequest\.id/);
  assert.match(cancel, /expectedVersion:\s*activeRequest\.version/);
  assert.match(component, /已有待审批的撤回申请/);
  assert.match(component, /不会转入问题中心/);
});

test('workflow center loads the dedicated queue and approves or rejects without a second direct-withdraw call', () => {
  const component = source('components/WorkflowCenterShell.tsx');
  const decisionStart = component.indexOf('async function submitWithdrawalDecision');
  const decisionEnd = component.indexOf('function openCompletionCorrection', decisionStart);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart);
  const decision = component.slice(decisionStart, decisionEnd);

  assert.match(component, /completion-withdrawal-requests\?status=PENDING&take=50/);
  assert.match(component, /completion-withdrawal-requests\?status=BLOCKED&take=25/);
  assert.match(component, /completion-withdrawal-requests\?status=STALE&take=25/);
  assert.match(component, /params\.get\('withdrawalRequestId'\)/);
  assert.match(component, /报工撤回审批/);
  assert.match(component, /撤回异常/);
  assert.match(decision, /action:\s*'APPROVE'\s*\|\s*'REJECT'/);
  assert.match(decision, /expectedVersion:\s*withdrawalApprovalTarget\.version/);
  assert.match(decision, /expectedRouteVersion:/);
  assert.match(decision, /APPLIED:[\s\S]*REJECTED:[\s\S]*BLOCKED:[\s\S]*STALE:/);
  assert.doesNotMatch(decision, /\/routes\/.*\/withdraw/);
  assert.match(component, /撤回异常；原报工未改动，也未创建问题单/);
});

test('manager direct withdrawal remains reason-free and reports blockers as withdrawal exceptions', () => {
  const component = source('components/WorkflowCenterShell.tsx');
  const directStart = component.indexOf('async function submitCompletionWithdrawal');
  const directEnd = component.indexOf('async function openWithdrawalApproval', directStart);
  assert.ok(directStart >= 0 && directEnd > directStart);
  const direct = component.slice(directStart, directEnd);

  assert.match(direct, /category:\s*withdrawalCategory/);
  assert.match(direct, /expectedRouteVersion:\s*withdrawalPreview\.routeVersion/);
  assert.doesNotMatch(direct, /reason:/);
  assert.doesNotMatch(direct, /issue/);
  assert.match(direct, /记录为撤回异常/);
});

test('shared frontend contract uses only the backend withdrawal request state machine', () => {
  const types = source('types/index.ts');
  const start = types.indexOf('export type CompletionWithdrawalRequestStatus');
  const end = types.indexOf('export type CompletionWithdrawalRequestDTO', start);
  assert.ok(start >= 0 && end > start);
  const statuses = types.slice(start, end);
  for (const status of ['PENDING', 'APPLIED', 'REJECTED', 'CANCELLED', 'BLOCKED', 'STALE']) {
    assert.match(statuses, new RegExp(`'${status}'`));
  }
  assert.doesNotMatch(statuses, /WITHDRAWN|REQUESTED|APPROVED/);
});
