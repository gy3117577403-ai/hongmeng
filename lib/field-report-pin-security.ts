import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import bcrypt from 'bcryptjs';

export const FIELD_REPORT_PIN_LENGTH = 6;
export const FIELD_REPORT_PIN_BCRYPT_ROUNDS = 12;
export const FIELD_REPORT_PIN_PEPPER_MIN_BYTES = 32;
export const FIELD_REPORT_SECRET_BYTES = 32;

const PIN_DOMAIN = 'hongmeng:field-report-pin:v1';
const TERMINAL_SECRET_DOMAIN = 'hongmeng:field-report-terminal:v1';
const SESSION_TOKEN_DOMAIN = 'hongmeng:field-report-pin-session:v1';

const SIMPLE_SEQUENCE_PINS = new Set([
  '012345',
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  '543210',
]);

export type FieldReportPinPolicyContext = {
  employeeNo?: string | null;
  mobile?: string | null;
};

export class FieldReportPinPolicyError extends Error {
  readonly code = 'FIELD_REPORT_PIN_POLICY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'FieldReportPinPolicyError';
  }
}

export class FieldReportPinConfigurationError extends Error {
  readonly code = 'FIELD_REPORT_PIN_PEPPER_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'FieldReportPinConfigurationError';
  }
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function fieldReportPinPolicyError(
  input: unknown,
  context: FieldReportPinPolicyContext = {},
): string | null {
  if (typeof input !== 'string' || !/^\d{6}$/.test(input)) {
    return `报工 PIN 必须为 ${FIELD_REPORT_PIN_LENGTH} 位数字`;
  }
  if (/^(\d)\1{5}$/.test(input) || SIMPLE_SEQUENCE_PINS.has(input)) {
    return '报工 PIN 不能使用重复数字或连续数字';
  }

  const employeeNo = digitsOnly(context.employeeNo);
  if (
    (employeeNo.length >= FIELD_REPORT_PIN_LENGTH && employeeNo.endsWith(input))
    || (
      employeeNo.length > 0
      && employeeNo.length < FIELD_REPORT_PIN_LENGTH
      && input === employeeNo.padStart(FIELD_REPORT_PIN_LENGTH, '0')
    )
  ) {
    return '报工 PIN 不能使用员工编号末 6 位';
  }
  const mobile = digitsOnly(context.mobile);
  if (mobile.length >= FIELD_REPORT_PIN_LENGTH && mobile.endsWith(input)) {
    return '报工 PIN 不能使用手机号末 6 位';
  }
  return null;
}

export function assertValidFieldReportPin(
  input: unknown,
  context: FieldReportPinPolicyContext = {},
): string {
  const error = fieldReportPinPolicyError(input, context);
  if (error) throw new FieldReportPinPolicyError(error);
  return input as string;
}

export function requireFieldReportPinPepper(
  value = process.env.FIELD_REPORT_PIN_PEPPER,
): string {
  const sessionSecret = process.env.SESSION_SECRET;
  const reusesSessionSecret = (
    typeof value === 'string'
    && typeof sessionSecret === 'string'
    && value.trim() === sessionSecret.trim()
  );
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') < FIELD_REPORT_PIN_PEPPER_MIN_BYTES
    || reusesSessionSecret
  ) {
    throw new FieldReportPinConfigurationError(
      `FIELD_REPORT_PIN_PEPPER 必须是至少 ${FIELD_REPORT_PIN_PEPPER_MIN_BYTES} 字节且无首尾空格的独立密钥`,
    );
  }
  return value;
}

function requireEmployeeId(value: unknown): string {
  const employeeId = String(value ?? '').trim();
  if (!employeeId || employeeId.includes('\0')) {
    throw new FieldReportPinConfigurationError('员工标识不能为空');
  }
  return employeeId;
}

/**
 * Domain-separated HMAC prevents a leaked database hash from being brute-forced
 * without the independently managed server pepper. The employee id also binds
 * a credential hash to its owner instead of making hashes transferable.
 */
export function deriveFieldReportPinMaterial(input: {
  pin: unknown;
  employeeId: unknown;
  pepper?: string;
}): string {
  const employeeId = requireEmployeeId(input.employeeId);
  const pepper = requireFieldReportPinPepper(input.pepper);
  return createHmac('sha256', pepper)
    .update(PIN_DOMAIN)
    .update('\0')
    .update(employeeId)
    .update('\0')
    .update(String(input.pin ?? ''))
    .digest('base64url');
}

export async function hashFieldReportPin(input: {
  pin: unknown;
  employeeId: unknown;
  employeeNo?: string | null;
  mobile?: string | null;
  pepper?: string;
}): Promise<string> {
  const pin = assertValidFieldReportPin(input.pin, {
    employeeNo: input.employeeNo,
    mobile: input.mobile,
  });
  const material = deriveFieldReportPinMaterial({
    pin,
    employeeId: input.employeeId,
    pepper: input.pepper,
  });
  return bcrypt.hash(material, FIELD_REPORT_PIN_BCRYPT_ROUNDS);
}

/** Verification intentionally hashes any supplied value; policy validation is
 * for credential creation, while authentication callers should use a valid
 * cost-12 dummy hash for unknown employees to preserve comparable work. */
export async function verifyFieldReportPin(input: {
  pin: unknown;
  employeeId: unknown;
  pinHash: string;
  pepper?: string;
}): Promise<boolean> {
  const material = deriveFieldReportPinMaterial({
    pin: input.pin,
    employeeId: input.employeeId,
    pepper: input.pepper,
  });
  try {
    return await bcrypt.compare(material, input.pinHash);
  } catch {
    return false;
  }
}

function asBytes(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

/**
 * Compares secret-derived values without an early exit on length or content.
 * Hashing first gives timingSafeEqual fixed-size inputs; the explicit length
 * equality prevents different byte strings with the same digest from matching.
 */
export function constantTimeEqual(
  left: string | Buffer,
  right: string | Buffer,
): boolean {
  const leftBytes = asBytes(left);
  const rightBytes = asBytes(right);
  const leftDigest = createHash('sha256').update(leftBytes).digest();
  const rightDigest = createHash('sha256').update(rightBytes).digest();
  const digestMatches = timingSafeEqual(leftDigest, rightDigest);
  return digestMatches && leftBytes.length === rightBytes.length;
}

function digestOpaqueSecret(secret: string, domain: string): string {
  return createHash('sha256')
    .update(domain)
    .update('\0')
    .update(secret)
    .digest('hex');
}

export function hashFieldReportTerminalSecret(secret: string): string {
  return digestOpaqueSecret(String(secret ?? ''), TERMINAL_SECRET_DOMAIN);
}

export function hashFieldReportSessionToken(token: string): string {
  return digestOpaqueSecret(String(token ?? ''), SESSION_TOKEN_DOMAIN);
}

export function verifyFieldReportTerminalSecret(
  secret: string,
  expectedHash: string,
): boolean {
  return constantTimeEqual(hashFieldReportTerminalSecret(secret), expectedHash);
}

export function verifyFieldReportSessionToken(
  token: string,
  expectedHash: string,
): boolean {
  return constantTimeEqual(hashFieldReportSessionToken(token), expectedHash);
}

export type GeneratedFieldReportSecret = {
  secret: string;
  secretHash: string;
};

export function generateFieldReportTerminalSecret(): GeneratedFieldReportSecret {
  const secret = `frt_${randomBytes(FIELD_REPORT_SECRET_BYTES).toString('base64url')}`;
  return { secret, secretHash: hashFieldReportTerminalSecret(secret) };
}

export function generateFieldReportSessionToken(): GeneratedFieldReportSecret {
  const secret = `frs_${randomBytes(FIELD_REPORT_SECRET_BYTES).toString('base64url')}`;
  return { secret, secretHash: hashFieldReportSessionToken(secret) };
}
