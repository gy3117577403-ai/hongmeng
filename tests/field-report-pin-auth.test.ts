import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessProfileKey, ProcessCompletionSource } from '@prisma/client';
import {
  assertFieldReportJsonMutation,
  canAttemptFieldReportCompletion,
  fieldReportLockUntil,
  fieldReportPinSessionCookieOptions,
  fieldReportTerminalCookieOptions,
  hasLiveFieldReporterGrant,
  isFieldReportLocked,
} from '../lib/field-report-pin-auth';
import {
  completionPrincipalIdentityMatches,
  parseProcessCompletionCommand,
  ProcessCompletionServiceError,
  sharedTerminalPinSessionSnapshotIsValid,
  sharedTerminalPrincipalSnapshotIsValid,
} from '../lib/process-completion-service';

function sharedTerminalCommand(overrides: Record<string, unknown> = {}) {
  return {
    routeId: 'route-pin-001',
    stepId: 'step-pin-001',
    processedQty: 12,
    defectQty: 0,
    workDate: '2026-08-10',
    employeeIds: ['employee-pin-001', 'employee-helper'],
    reportSource: ProcessCompletionSource.SHARED_TERMINAL_PIN,
    principalEmployeeId: 'employee-pin-001',
    fieldReportTerminalId: 'terminal-001',
    pinCredentialVersion: 3,
    fieldReportPinSession: {
      sessionId: 'session-001',
      tokenHash: 'a'.repeat(64),
      terminalId: 'terminal-001',
      terminalVersion: 2,
      credentialId: 'credential-001',
      credentialVersion: 3,
      employeeId: 'employee-pin-001',
      userId: 'user-pin-001',
      ticketId: 'ticket-001',
    },
    idempotencyKey: 'pin-completion-request-001',
    expectedRouteVersion: 4,
    userId: 'user-pin-001',
    actor: '0001 · 测试员工',
    ...overrides,
  };
}

test('shared-terminal cookies are strict and the PIN identity expires after five minutes', () => {
  assert.equal(fieldReportTerminalCookieOptions().sameSite, 'strict');
  assert.equal(fieldReportPinSessionCookieOptions().sameSite, 'strict');
  assert.equal(fieldReportPinSessionCookieOptions().maxAge, 300);
});

test('shared-terminal browser mutations reject sibling-site and non-JSON requests', () => {
  assert.doesNotThrow(() => assertFieldReportJsonMutation(new Request('http://localhost/api/field-report/pin-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
  })));
  assert.throws(() => assertFieldReportJsonMutation(new Request('http://localhost/api/field-report/pin-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-site',
    },
  })));
  assert.throws(() => assertFieldReportJsonMutation(new Request('http://localhost/api/field-report/pin-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
  })));
});

test('credential and terminal lock windows use the requested threshold and duration', () => {
  const now = new Date('2026-08-10T00:00:00.000Z');
  assert.equal(fieldReportLockUntil(4, 5, now), null);
  const lockedUntil = fieldReportLockUntil(5, 5, now);
  assert.equal(lockedUntil?.toISOString(), '2026-08-10T00:15:00.000Z');
  assert.equal(isFieldReportLocked(lockedUntil, new Date('2026-08-10T00:14:59.999Z')), true);
  assert.equal(isFieldReportLocked(lockedUntil, new Date('2026-08-10T00:15:00.000Z')), false);
});

test('FIELD_REPORTER grant must be live and scoped to the same employee', () => {
  const now = new Date('2026-08-10T00:00:00.000Z');
  const user = {
    id: 'user-pin-001',
    isActive: true,
    accountStatus: 'ACTIVE',
    employeeId: 'employee-pin-001',
    accessGrants: [{
      profile: AccessProfileKey.FIELD_REPORTER,
      scopeKey: 'EMPLOYEE:employee-pin-001',
      isActive: true,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: null,
    }],
  };
  assert.equal(hasLiveFieldReporterGrant(user, 'employee-pin-001', now), true);
  assert.equal(hasLiveFieldReporterGrant({
    ...user,
    accessGrants: [{ ...user.accessGrants[0], scopeKey: 'EMPLOYEE:other' }],
  }, 'employee-pin-001', now), false);
});

test('shared-terminal completion parser preserves principal evidence and requires the principal participant', () => {
  const parsed = parseProcessCompletionCommand(sharedTerminalCommand());
  assert.equal(parsed.reportSource, ProcessCompletionSource.SHARED_TERMINAL_PIN);
  assert.equal(parsed.principalEmployeeId, 'employee-pin-001');
  assert.equal(parsed.fieldReportTerminalId, 'terminal-001');
  assert.equal(parsed.pinCredentialVersion, 3);
  assert.equal(parsed.fieldReportPinSession?.sessionId, 'session-001');

  assert.throws(
    () => parseProcessCompletionCommand(sharedTerminalCommand({ employeeIds: ['employee-helper'] })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_PIN_PRINCIPAL_PARTICIPANT_REQUIRED',
  );
  assert.throws(
    () => parseProcessCompletionCommand(sharedTerminalCommand({ pinCredentialVersion: undefined })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_PIN_PRINCIPAL_REQUIRED',
  );
  assert.throws(
    () => parseProcessCompletionCommand(sharedTerminalCommand({
      fieldReportPinSession: {
        ...(sharedTerminalCommand().fieldReportPinSession as Record<string, unknown>),
        userId: 'different-user',
      },
    })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_PIN_PRINCIPAL_REQUIRED',
  );
});

test('idempotency identity rejects a different employee, terminal, or credential generation', () => {
  const stored = {
    principalEmployeeId: 'employee-pin-001',
    fieldReportTerminalId: 'terminal-001',
    pinCredentialVersion: 3,
  };
  assert.equal(completionPrincipalIdentityMatches(stored, { ...stored }), true);
  assert.equal(completionPrincipalIdentityMatches(stored, { ...stored, principalEmployeeId: 'employee-pin-002' }), false);
  assert.equal(completionPrincipalIdentityMatches(stored, { ...stored, fieldReportTerminalId: 'terminal-002' }), false);
  assert.equal(completionPrincipalIdentityMatches(stored, { ...stored, pinCredentialVersion: 4 }), false);
});

test('same-transaction live principal validation fails closed after PIN reset or terminal revoke', () => {
  const input = {
    principalEmployeeId: 'employee-pin-001',
    pinCredentialVersion: 3,
    userId: 'user-pin-001',
  };
  const snapshot = {
    credential: { credentialVersion: 3, isActive: true, lockedUntil: null },
    terminal: { isActive: true, lockedUntil: null },
    employeeExists: true,
    user: {
      id: 'user-pin-001',
      isActive: true,
      accountStatus: 'ACTIVE',
      employeeId: 'employee-pin-001',
      fieldReporterGrantCount: 1,
    },
  };
  assert.equal(sharedTerminalPrincipalSnapshotIsValid(input, snapshot), true);
  assert.equal(sharedTerminalPrincipalSnapshotIsValid(input, {
    ...snapshot,
    credential: { ...snapshot.credential, credentialVersion: 4 },
  }), false);
  assert.equal(sharedTerminalPrincipalSnapshotIsValid(input, {
    ...snapshot,
    terminal: { ...snapshot.terminal, isActive: false },
  }), false);
});

test('PIN session state permits one atomic consume and only the same-session replay afterward', () => {
  const now = new Date('2026-08-10T00:00:00.000Z');
  const evidence = {
    sessionId: 'session-001',
    tokenHash: 'a'.repeat(64),
    terminalId: 'terminal-001',
    terminalVersion: 2,
    credentialId: 'credential-001',
    credentialVersion: 3,
    employeeId: 'employee-pin-001',
    userId: 'user-pin-001',
    ticketId: 'ticket-001',
  };
  const fresh = {
    id: evidence.sessionId,
    tokenHash: evidence.tokenHash,
    terminalId: evidence.terminalId,
    terminalVersion: evidence.terminalVersion,
    credentialId: evidence.credentialId,
    credentialVersion: evidence.credentialVersion,
    employeeId: evidence.employeeId,
    userId: evidence.userId,
    ticketId: evidence.ticketId,
    expiresAt: new Date('2026-08-10T00:05:00.000Z'),
    consumedAt: null,
    revokedAt: null,
    ticketStatus: 'ACTIVE',
    ticketRouteId: 'route-pin-001',
  };
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    fresh,
    { routeId: 'route-pin-001' },
    'consume',
    now,
  ), true);
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    fresh,
    { routeId: 'route-pin-001' },
    'replay',
    now,
  ), false);

  const consumed = { ...fresh, consumedAt: new Date('2026-08-10T00:00:01.000Z') };
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    consumed,
    { routeId: 'route-pin-001' },
    'replay',
    now,
  ), true);
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    consumed,
    { routeId: 'route-pin-001' },
    'consume',
    now,
  ), false);
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    { ...consumed, tokenHash: 'b'.repeat(64) },
    { routeId: 'route-pin-001' },
    'replay',
    now,
  ), false);
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    { ...consumed, ticketRouteId: 'route-other' },
    { routeId: 'route-pin-001' },
    'replay',
    now,
  ), false);
  assert.equal(sharedTerminalPinSessionSnapshotIsValid(
    evidence,
    { ...consumed, revokedAt: now },
    { routeId: 'route-pin-001' },
    'replay',
    now,
  ), false);
});

test('a consumed PIN session reaches idempotency replay after the final route is no longer reportable', () => {
  assert.equal(canAttemptFieldReportCompletion({
    routeAvailable: true,
    canReport: false,
    pinSessionConsumed: true,
  }), true);
  assert.equal(canAttemptFieldReportCompletion({
    routeAvailable: true,
    canReport: false,
    pinSessionConsumed: false,
  }), false);
  assert.equal(canAttemptFieldReportCompletion({
    routeAvailable: false,
    canReport: true,
    pinSessionConsumed: true,
  }), false);
});
