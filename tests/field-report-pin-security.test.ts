import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {
  assertValidFieldReportPin,
  constantTimeEqual,
  deriveFieldReportPinMaterial,
  FIELD_REPORT_PIN_BCRYPT_ROUNDS,
  FIELD_REPORT_PIN_PEPPER_MIN_BYTES,
  FieldReportPinConfigurationError,
  FieldReportPinPolicyError,
  generateFieldReportSessionToken,
  generateFieldReportTerminalSecret,
  hashFieldReportPin,
  hashFieldReportSessionToken,
  hashFieldReportTerminalSecret,
  requireFieldReportPinPepper,
  verifyFieldReportPin,
  verifyFieldReportSessionToken,
  verifyFieldReportTerminalSecret,
} from '@/lib/field-report-pin-security';

const PEPPER = 'pin-pepper-for-tests-32-bytes-minimum-value';

test('PIN policy accepts a nontrivial six-digit PIN', () => {
  assert.equal(assertValidFieldReportPin('482907'), '482907');
});

test('PIN policy rejects malformed, trivial and employee-derived PINs', () => {
  const invalid = [
    '',
    '12345',
    '1234567',
    '12a456',
    ' 482907',
    '111111',
    '123456',
    '654321',
  ];
  for (const pin of invalid) {
    assert.throws(
      () => assertValidFieldReportPin(pin),
      (error: unknown) => error instanceof FieldReportPinPolicyError,
      `expected ${JSON.stringify(pin)} to be rejected`,
    );
  }

  assert.throws(
    () => assertValidFieldReportPin('482907', { employeeNo: 'EMP-482907' }),
    FieldReportPinPolicyError,
  );
  assert.throws(
    () => assertValidFieldReportPin('000003', { employeeNo: '0003' }),
    FieldReportPinPolicyError,
  );
  assert.throws(
    () => assertValidFieldReportPin('482907', { mobile: '+86 189 1148 2907' }),
    FieldReportPinPolicyError,
  );
});

test('pepper must be an independent trimmed secret of at least 32 bytes', () => {
  assert.equal(requireFieldReportPinPepper(PEPPER), PEPPER);
  assert.ok(Buffer.byteLength(PEPPER, 'utf8') >= FIELD_REPORT_PIN_PEPPER_MIN_BYTES);

  for (const pepper of [undefined, '', 'short-pin-pepper', `${'x'.repeat(32)} `]) {
    assert.throws(
      () => requireFieldReportPinPepper(pepper),
      (error: unknown) => error instanceof FieldReportPinConfigurationError,
    );
  }
});

test('pepper cannot reuse SESSION_SECRET after trim normalization', () => {
  const previousSessionSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = PEPPER;
    assert.throws(
      () => requireFieldReportPinPepper(PEPPER),
      (error: unknown) => error instanceof FieldReportPinConfigurationError,
    );

    process.env.SESSION_SECRET = `  ${PEPPER}  `;
    assert.throws(
      () => requireFieldReportPinPepper(PEPPER),
      (error: unknown) => error instanceof FieldReportPinConfigurationError,
    );

    process.env.SESSION_SECRET = `${PEPPER}-different`;
    assert.equal(requireFieldReportPinPepper(PEPPER), PEPPER);
  } finally {
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});

test('PIN material is deterministic, peppered and bound to the employee', () => {
  const input = { pin: '482907', employeeId: 'employee-a', pepper: PEPPER };
  const first = deriveFieldReportPinMaterial(input);
  assert.equal(first, deriveFieldReportPinMaterial(input));
  assert.notEqual(first, deriveFieldReportPinMaterial({ ...input, employeeId: 'employee-b' }));
  assert.notEqual(first, deriveFieldReportPinMaterial({ ...input, pepper: `${PEPPER}-rotated` }));
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
});

test('PIN hashes use bcrypt cost 12 and verify only the bound credential', async () => {
  const pinHash = await hashFieldReportPin({
    pin: '482907',
    employeeId: 'employee-a',
    employeeNo: '0003',
    pepper: PEPPER,
  });

  assert.equal(bcrypt.getRounds(pinHash), FIELD_REPORT_PIN_BCRYPT_ROUNDS);
  assert.match(pinHash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyFieldReportPin({
    pin: '482907', employeeId: 'employee-a', pinHash, pepper: PEPPER,
  }), true);
  assert.equal(await verifyFieldReportPin({
    pin: '482908', employeeId: 'employee-a', pinHash, pepper: PEPPER,
  }), false);
  assert.equal(await verifyFieldReportPin({
    pin: '482907', employeeId: 'employee-b', pinHash, pepper: PEPPER,
  }), false);
  assert.equal(await verifyFieldReportPin({
    pin: '482907', employeeId: 'employee-a', pinHash, pepper: `${PEPPER}-rotated`,
  }), false);
});

test('bcrypt salting gives the same PIN distinct stored hashes', async () => {
  const input = { pin: '482907', employeeId: 'employee-a', pepper: PEPPER };
  const [first, second] = await Promise.all([
    hashFieldReportPin(input),
    hashFieldReportPin(input),
  ]);
  assert.notEqual(first, second);
  assert.equal(await verifyFieldReportPin({ ...input, pinHash: first }), true);
  assert.equal(await verifyFieldReportPin({ ...input, pinHash: second }), true);
});

test('terminal and session secrets have independent random values and digest domains', () => {
  const terminalA = generateFieldReportTerminalSecret();
  const terminalB = generateFieldReportTerminalSecret();
  const session = generateFieldReportSessionToken();

  assert.match(terminalA.secret, /^frt_[A-Za-z0-9_-]{43}$/);
  assert.match(session.secret, /^frs_[A-Za-z0-9_-]{43}$/);
  assert.match(terminalA.secretHash, /^[0-9a-f]{64}$/);
  assert.match(session.secretHash, /^[0-9a-f]{64}$/);
  assert.notEqual(terminalA.secret, terminalB.secret);
  assert.notEqual(terminalA.secretHash, terminalB.secretHash);
  assert.notEqual(
    hashFieldReportTerminalSecret(terminalA.secret),
    hashFieldReportSessionToken(terminalA.secret),
  );
  assert.equal(verifyFieldReportTerminalSecret(terminalA.secret, terminalA.secretHash), true);
  assert.equal(verifyFieldReportTerminalSecret(`${terminalA.secret}x`, terminalA.secretHash), false);
  assert.equal(verifyFieldReportSessionToken(session.secret, session.secretHash), true);
  assert.equal(verifyFieldReportSessionToken(`${session.secret}x`, session.secretHash), false);
});

test('constant-time equality helper handles equal, unequal and different-length values', () => {
  assert.equal(constantTimeEqual('same-secret', 'same-secret'), true);
  assert.equal(constantTimeEqual('same-secret', 'same-secreu'), false);
  assert.equal(constantTimeEqual('same-secret', 'short'), false);
  assert.equal(constantTimeEqual(Buffer.from('bytes'), Buffer.from('bytes')), true);
});
