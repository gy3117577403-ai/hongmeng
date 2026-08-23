import crypto from 'node:crypto';

export const TRAINING_QR_PURPOSES = ['CHECK_IN', 'FEEDBACK'] as const;
export const TRAINING_QR_WINDOW_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'REVOKED'] as const;
export const TRAINING_SESSION_ATTENDANCE_STATUSES = ['INVITED', 'PRESENT', 'LATE', 'ABSENT', 'LEAVE'] as const;
export const TRAINING_SESSION_ATTENDANCE_SOURCES = [
  'SYSTEM_INVITE',
  'SYSTEM_FINALIZE',
  'QR_SELF',
  'ADMIN_MANUAL',
  'LEGACY_MIGRATION',
] as const;
export const TRAINING_FEEDBACK_TAGS = [
  '内容偏难',
  '内容偏浅',
  '节奏过快',
  '节奏过慢',
  '案例不足',
  '实操不足',
  '设备问题',
  '场地问题',
  '其他',
] as const;

export type TrainingQrPurpose = typeof TRAINING_QR_PURPOSES[number];
export type TrainingQrWindowStatus = typeof TRAINING_QR_WINDOW_STATUSES[number];
export type TrainingSessionAttendanceStatus = typeof TRAINING_SESSION_ATTENDANCE_STATUSES[number];
export type TrainingSessionAttendanceSource = typeof TRAINING_SESSION_ATTENDANCE_SOURCES[number];

export class TrainingQrError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'TRAINING_QR_INVALID') {
    super(message);
    this.name = 'TrainingQrError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function trainingQrSigningSecret(): string {
  const secret = process.env.TRAINING_QR_SIGNING_SECRET || process.env.SESSION_SECRET || '';
  if (secret.length < 32) {
    throw new TrainingQrError('培训二维码签名密钥未正确配置', 503, 'TRAINING_QR_SECRET_UNAVAILABLE');
  }
  return secret;
}

function canonicalQrPayload(input: {
  id: string;
  generation: number;
  sessionId: string;
  purpose: TrainingQrPurpose;
}): string {
  return `training-qr:v1:${input.id}:${input.generation}:${input.sessionId}:${input.purpose}`;
}

export function createTrainingQrCode(input: {
  id: string;
  generation: number;
  sessionId: string;
  purpose: TrainingQrPurpose;
  secret?: string;
}): string {
  const secret = input.secret || trainingQrSigningSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(canonicalQrPayload(input))
    .digest('base64url');
  return `${input.id}.${input.generation}.${signature}`;
}

export function hashTrainingQrCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function parseTrainingQrCode(value: unknown): {
  id: string;
  generation: number;
  signature: string;
} {
  const code = cleanText(value, 240);
  const parts = code.split('.');
  if (
    parts.length !== 3
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[0])
    || !/^\d{1,9}$/.test(parts[1])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
  ) {
    throw new TrainingQrError('培训二维码无效或内容不完整', 404, 'TRAINING_QR_NOT_FOUND');
  }
  return { id: parts[0], generation: Number(parts[1]), signature: parts[2] };
}

export function verifyTrainingQrCode(input: {
  code: string;
  id: string;
  generation: number;
  sessionId: string;
  purpose: TrainingQrPurpose;
  tokenHash: string;
  secret?: string;
}): boolean {
  const parsed = parseTrainingQrCode(input.code);
  if (parsed.id !== input.id || parsed.generation !== input.generation) return false;
  const expected = createTrainingQrCode(input);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.code);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    && hashTrainingQrCode(input.code) === input.tokenHash;
}

export function trainingQrTemporalState(input: {
  status: string;
  opensAt: Date;
  expiresAt: Date;
  now?: Date;
}): 'SCHEDULED' | 'OPEN' | 'EXPIRED' | 'CLOSED' | 'REVOKED' {
  if (input.status === 'REVOKED') return 'REVOKED';
  if (input.status === 'CLOSED') return 'CLOSED';
  const now = input.now ?? new Date();
  if (now.getTime() < input.opensAt.getTime()) return 'SCHEDULED';
  if (now.getTime() >= input.expiresAt.getTime()) return 'EXPIRED';
  return 'OPEN';
}

export function trainingCheckInSchedule(input: {
  startAt: Date;
  checkInOpenMinutes: number;
  lateAfterMinutes: number;
  checkInCloseMinutes: number;
}) {
  const start = input.startAt.getTime();
  return {
    opensAt: new Date(start - input.checkInOpenMinutes * 60_000),
    lateAt: new Date(start + input.lateAfterMinutes * 60_000),
    expiresAt: new Date(start + input.checkInCloseMinutes * 60_000),
  };
}

export function trainingCheckInStatus(input: {
  startAt: Date;
  lateAfterMinutes: number;
  now?: Date;
}): 'PRESENT' | 'LATE' {
  const now = input.now ?? new Date();
  const lateAt = input.startAt.getTime() + input.lateAfterMinutes * 60_000;
  return now.getTime() >= lateAt ? 'LATE' : 'PRESENT';
}

function feedbackRating(value: unknown, label: string): number {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new TrainingQrError(`${label}必须为 1–5 分`, 400, 'TRAINING_FEEDBACK_INVALID');
  }
  return rating;
}

export function parseTrainingFeedbackInput(body: Record<string, unknown>) {
  const tags = Array.isArray(body.issueTags) ? body.issueTags : [];
  const issueTags = [...new Set(tags
    .map(tag => cleanText(tag, 30))
    .filter((tag): tag is typeof TRAINING_FEEDBACK_TAGS[number] => (
      TRAINING_FEEDBACK_TAGS.includes(tag as typeof TRAINING_FEEDBACK_TAGS[number])
    )))]
    .slice(0, 6);
  const versionValue = body.version;
  const version = versionValue === undefined || versionValue === null || versionValue === ''
    ? null
    : Number(versionValue);
  if (version !== null && (!Number.isInteger(version) || version < 1)) {
    throw new TrainingQrError('反馈版本不正确，请刷新后重试', 409, 'TRAINING_FEEDBACK_VERSION_INVALID');
  }
  return {
    overallRating: feedbackRating(body.overallRating, '整体满意度'),
    contentRating: feedbackRating(body.contentRating, '课程内容评分'),
    trainerRating: feedbackRating(body.trainerRating, '讲师表现评分'),
    practicalValueRating: feedbackRating(body.practicalValueRating, '实用程度评分'),
    issueTags,
    comment: cleanText(body.comment, 2_000) || null,
    followUpRequested: body.followUpRequested === true,
    version,
  };
}
