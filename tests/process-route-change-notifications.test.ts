import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  processNotificationLifecyclePolicy,
  processStageNotificationIsCurrent,
} from '../lib/process-route-change-notifications';

test('process route stages supersede older stage notifications while terminal events start in history', () => {
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_SUBMITTED'), {
    initiallyCompleted: false,
    supersedeScope: 'change',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_REEVALUATED'), {
    initiallyCompleted: false,
    supersedeScope: 'change',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_APPROVED'), {
    initiallyCompleted: false,
    supersedeScope: 'change',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_REJECTED'), {
    initiallyCompleted: true,
    supersedeScope: 'change',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_ACTIVATED'), {
    initiallyCompleted: true,
    supersedeScope: 'change',
  });
});

test('recoverable activating and failed states never hide the last actionable process notification', () => {
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_ACTIVATING'), {
    initiallyCompleted: false,
    supersedeScope: 'none',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_ROUTE_CHANGE_FAILED'), {
    initiallyCompleted: false,
    supersedeScope: 'none',
  });
});

test('current process status and latest durable outbox prevent late older stages from reopening work', () => {
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_APPROVED', 'APPROVED', true), true);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_APPROVED', 'ACTIVATING', true), true);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_APPROVED', 'FAILED', true), true);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_SUBMITTED', 'APPROVED', false), false);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_SUBMITTED', 'APPROVED', true), false);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_REEVALUATED', 'SUBMITTED', true), true);
  assert.equal(processStageNotificationIsCurrent('PROCESS_ROUTE_CHANGE_ACTIVATED', 'ACTIVE', true), true);
});

test('supplement progress supersedes only a proven obligation and fulfillment starts completed', () => {
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_SUPPLEMENT_OBLIGATION_REPORTED', 'obligation-a'), {
    initiallyCompleted: true,
    supersedeScope: 'obligation',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED', 'obligation-a'), {
    initiallyCompleted: true,
    supersedeScope: 'obligation',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_SUPPLEMENT_OBLIGATION_REPORTED'), {
    initiallyCompleted: true,
    supersedeScope: 'none',
  });
  assert.deepEqual(processNotificationLifecyclePolicy('PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'), {
    initiallyCompleted: true,
    supersedeScope: 'none',
  });
});

test('completion migration uses business outbox evidence and preserves failed, unknown, and cross-obligation rows', () => {
  const migration = readFileSync(new URL(
    '../prisma/migrations/202608290005_notification_completion_state/migration.sql',
    import.meta.url,
  ), 'utf8');
  assert.match(migration, /JOIN "process_route_change_outbox"/);
  assert.match(migration, /"later_outbox"\."created_at" > "origin_outbox"\."created_at"/);
  assert.match(migration, /PROCESS_ROUTE_CHANGE_REJECTED/);
  assert.match(migration, /PROCESS_ROUTE_CHANGE_ACTIVATED/);
  assert.match(migration, /PROCESS_SUPPLEMENT_OBLIGATION_REPORTED/);
  assert.match(migration, /PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED/);
  assert.match(migration, /"completion_kind" = 'SYSTEM_RECONCILED'/);
  assert.doesNotMatch(migration, /ROW_NUMBER\(\)/);
  assert.doesNotMatch(migration, /"notification"\."created_at"/);
  assert.doesNotMatch(migration, /'PROCESS_ROUTE_CHANGE_FAILED'/);
});
