import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { parseTrainingLocalTime } from '@/lib/training-time';

export const TRAINING_PLAN_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const;

export const TRAINING_ATTENDANCE_STATUSES = [
  'INVITED',
  'PRESENT',
  'LATE',
  'PARTIAL',
  'ABSENT',
  'LEAVE',
] as const;

export const TRAINING_REVIEW_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'RETURNED',
] as const;

export const TRAINING_ASSESSMENT_MODES = ['NONE', 'THEORY', 'PRACTICAL', 'COMBINED'] as const;
export const TRAINING_MODES = ['OFFLINE', 'ONLINE', 'BLENDED'] as const;
export const TRAINING_ATTACHMENT_KINDS = [
  'COURSE_MATERIAL',
  'NOTICE',
  'SIGN_IN_SHEET',
  'PHOTO',
  'EVIDENCE',
  'OTHER',
] as const;

export type TrainingPlanStatus = typeof TRAINING_PLAN_STATUSES[number];
export type TrainingAttendanceStatus = typeof TRAINING_ATTENDANCE_STATUSES[number];
export type TrainingReviewStatus = typeof TRAINING_REVIEW_STATUSES[number];
export type TrainingAssessmentMode = typeof TRAINING_ASSESSMENT_MODES[number];
export type TrainingMode = typeof TRAINING_MODES[number];
export type TrainingAttachmentKind = typeof TRAINING_ATTACHMENT_KINDS[number];

export class TrainingInputError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'TrainingInputError';
    this.statusCode = statusCode;
  }
}

export const trainingCourseInclude = {
  skill: true,
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.TrainingCourseInclude;

export const trainingPlanInclude = {
  course: { include: trainingCourseInclude },
  sessions: {
    include: {
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    },
    orderBy: [{ sequence: 'asc' as const }, { startAt: 'asc' as const }],
  },
  participants: {
    include: {
      employee: true,
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    },
    orderBy: [
      { departmentSnapshot: 'asc' as const },
      { teamSnapshot: 'asc' as const },
      { employeeNoSnapshot: 'asc' as const },
    ],
  },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
  },
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
  },
} satisfies Prisma.TrainingPlanInclude;

type TrainingCourseRecord = Prisma.TrainingCourseGetPayload<{ include: typeof trainingCourseInclude }>;
type TrainingPlanRecord = Prisma.TrainingPlanGetPayload<{ include: typeof trainingPlanInclude }>;

export type TrainingPerson = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  isActive: boolean;
};

export function cleanTrainingText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T {
  const text = cleanTrainingText(value, 40) || fallback;
  if (!allowed.includes(text as T)) throw new TrainingInputError(`${label}不正确`);
  return text as T;
}

export function parseTrainingDateTime(value: unknown, label: string): Date {
  const text = cleanTrainingText(value, 80);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    try { return parseTrainingLocalTime(text); }
    catch { throw new TrainingInputError(`${label}格式不正确`); }
  }
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw new TrainingInputError(`${label}格式不正确`);
  return date;
}

export function parseOptionalTrainingInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TrainingInputError(`${label}应为 ${minimum}–${maximum} 的整数`);
  }
  return number;
}

export function parseCourseInput(body: Record<string, unknown>) {
  const name = cleanTrainingText(body.name, 160);
  if (!name) throw new TrainingInputError('请填写课程名称');
  const duration = parseOptionalTrainingInteger(body.defaultDurationMinutes, '默认时长', 1, 24 * 60) ?? 60;
  const assessmentMode = enumValue(body.assessmentMode, TRAINING_ASSESSMENT_MODES, 'NONE', '考核方式');
  const passScore = assessmentMode === 'NONE'
    ? null
    : parseOptionalTrainingInteger(body.passScore, '合格分', 0, 100) ?? 80;
  const targetLevel = parseOptionalTrainingInteger(body.targetLevel, '认证等级', 1, 5);
  const validityMonths = parseOptionalTrainingInteger(body.validityMonths, '证书有效月数', 1, 120);
  const retrainingMonths = parseOptionalTrainingInteger(body.retrainingMonths, '复训周期', 1, 120);
  return {
    name,
    category: cleanTrainingText(body.category, 80) || '岗位技能',
    objective: cleanTrainingText(body.objective, 1_000) || null,
    description: cleanTrainingText(body.description, 4_000) || null,
    targetAudience: cleanTrainingText(body.targetAudience, 500) || null,
    defaultDurationMinutes: duration,
    mode: enumValue(body.mode, TRAINING_MODES, 'OFFLINE', '培训方式'),
    isRequired: body.isRequired === true,
    assessmentMode,
    passScore,
    skillId: cleanTrainingText(body.skillId, 80) || null,
    targetLevel,
    validityMonths,
    retrainingMonths,
    ownerEmployeeId: cleanTrainingText(body.ownerEmployeeId, 80) || null,
    status: cleanTrainingText(body.status, 30) || 'ACTIVE',
  };
}

export function parsePlanInput(body: Record<string, unknown>) {
  const title = cleanTrainingText(body.title, 180);
  if (!title) throw new TrainingInputError('请填写培训计划名称');
  const startAt = parseTrainingDateTime(body.startAt, '开始时间');
  const endAt = parseTrainingDateTime(body.endAt, '结束时间');
  if (endAt.getTime() <= startAt.getTime()) throw new TrainingInputError('结束时间必须晚于开始时间');
  const assessmentMode = enumValue(body.assessmentMode, TRAINING_ASSESSMENT_MODES, 'NONE', '考核方式');
  const passScore = assessmentMode === 'NONE'
    ? null
    : parseOptionalTrainingInteger(body.passScore, '合格分', 0, 100) ?? 80;
  const checkInOpenMinutes = parseOptionalTrainingInteger(body.checkInOpenMinutes, '签到提前开放分钟', 0, 1_440) ?? 30;
  const lateAfterMinutes = parseOptionalTrainingInteger(body.lateAfterMinutes, '迟到宽限分钟', 0, 1_440) ?? 5;
  const checkInCloseMinutes = parseOptionalTrainingInteger(body.checkInCloseMinutes, '签到截止分钟', 0, 1_440) ?? 15;
  if (checkInCloseMinutes < lateAfterMinutes) {
    throw new TrainingInputError('签到截止分钟不能早于迟到宽限分钟');
  }
  const rawIds = Array.isArray(body.participantIds) ? body.participantIds : [];
  const participantIds = [...new Set(rawIds.map(id => cleanTrainingText(id, 80)).filter(Boolean))];
  return {
    title,
    courseId: cleanTrainingText(body.courseId, 80) || null,
    purpose: cleanTrainingText(body.purpose, 2_000) || null,
    scopeType: cleanTrainingText(body.scopeType, 30) || 'SELECTED',
    scopeDescription: cleanTrainingText(body.scopeDescription, 500) || null,
    organizerId: cleanTrainingText(body.organizerId, 80) || null,
    trainerId: cleanTrainingText(body.trainerId, 80) || null,
    reviewerId: cleanTrainingText(body.reviewerId, 80) || null,
    departmentId: cleanTrainingText(body.departmentId, 80) || null,
    startAt,
    endAt,
    location: cleanTrainingText(body.location, 240) || null,
    mode: enumValue(body.mode, TRAINING_MODES, 'OFFLINE', '培训方式'),
    isRequired: body.isRequired === true,
    assessmentMode,
    passScore,
    checkInOpenMinutes,
    lateAfterMinutes,
    checkInCloseMinutes,
    feedbackDeadlineHours: parseOptionalTrainingInteger(body.feedbackDeadlineHours, '反馈截止小时', 1, 720) ?? 24,
    feedbackRequired: body.feedbackRequired === true,
    participantIds,
  };
}

export function trainingCode(prefix: 'TRC' | 'TRP'): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export function addTrainingMonths(date: Date, months: number): Date {
  const sourceDay = date.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const targetMonthEnd = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  return new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
    Math.min(sourceDay, targetMonthEnd),
  ));
}

export function trainingCourseSnapshot(course: {
  id: string;
  code: string;
  name: string;
  category: string;
  objective: string | null;
  description: string | null;
  targetAudience: string | null;
  version: number;
  skillId: string | null;
  skill?: { name: string } | null;
  targetLevel: number | null;
  validityMonths: number | null;
  retrainingMonths: number | null;
}): Prisma.InputJsonObject {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    category: course.category,
    objective: course.objective,
    description: course.description,
    targetAudience: course.targetAudience,
    version: course.version,
    skillId: course.skillId,
    skillName: course.skill?.name || null,
    targetLevel: course.targetLevel,
    validityMonths: course.validityMonths,
    retrainingMonths: course.retrainingMonths,
  };
}

export function calculateTrainingScore(input: {
  mode: string;
  theoryScore: number | null;
  practicalScore: number | null;
}): number | null {
  if (input.mode === 'NONE') return null;
  if (input.mode === 'THEORY') return input.theoryScore;
  if (input.mode === 'PRACTICAL') return input.practicalScore;
  if (input.theoryScore === null || input.practicalScore === null) return null;
  return Math.round((input.theoryScore + input.practicalScore) / 2);
}

export function nextTrainingPlanStatus(current: string, action: string): TrainingPlanStatus {
  if (action === 'publish' && current === 'DRAFT') return 'PUBLISHED';
  if (action === 'start' && current === 'PUBLISHED') return 'IN_PROGRESS';
  if (action === 'submit_review' && current === 'IN_PROGRESS') return 'PENDING_REVIEW';
  if (action === 'complete' && ['IN_PROGRESS', 'PENDING_REVIEW'].includes(current)) return 'COMPLETED';
  if (action === 'cancel' && !['COMPLETED', 'CANCELLED'].includes(current)) return 'CANCELLED';
  throw new TrainingInputError('当前计划状态不能执行此操作', 409);
}

export function isFormalTrainingRecord(input: {
  planStatus: string;
  assessmentMode: string;
  attendanceStatus: string;
  result: string;
  reviewStatus: string;
}): boolean {
  if (input.planStatus !== 'COMPLETED') return false;
  if (!['PRESENT', 'LATE'].includes(input.attendanceStatus)) return false;
  if (input.assessmentMode === 'NONE') return input.reviewStatus === 'NOT_REQUIRED';
  return input.reviewStatus === 'APPROVED' && ['PASSED', 'FAILED'].includes(input.result);
}

function serializeAttachment(attachment: {
  id: string;
  kind: string;
  originalName: string;
  displayName: string | null;
  mimeType: string;
  size: bigint;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.displayName?.trim() || attachment.originalName,
    mimeType: attachment.mimeType,
    size: Number(attachment.size),
    createdAt: attachment.createdAt.toISOString(),
    contentUrl: `/api/training/attachments/${attachment.id}/content`,
  };
}

export function serializeTrainingCourse(course: TrainingCourseRecord) {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    category: course.category,
    objective: course.objective,
    description: course.description,
    targetAudience: course.targetAudience,
    defaultDurationMinutes: course.defaultDurationMinutes,
    mode: course.mode,
    isRequired: course.isRequired,
    assessmentMode: course.assessmentMode,
    passScore: course.passScore,
    skillId: course.skillId,
    skill: course.skill ? {
      id: course.skill.id,
      code: course.skill.code,
      name: course.skill.name,
      category: course.skill.category,
    } : null,
    targetLevel: course.targetLevel,
    validityMonths: course.validityMonths,
    retrainingMonths: course.retrainingMonths,
    ownerEmployeeId: course.ownerEmployeeId,
    status: course.status,
    version: course.version,
    attachments: course.attachments.map(serializeAttachment),
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

function personName(people: ReadonlyMap<string, TrainingPerson>, id: string | null): string | null {
  return id ? people.get(id)?.name || null : null;
}

export function serializeTrainingPlan(plan: TrainingPlanRecord, people: ReadonlyMap<string, TrainingPerson>) {
  const passScore = plan.passScore ?? 80;
  const attended = plan.participants.filter(item => ['PRESENT', 'LATE'].includes(item.attendanceStatus)).length;
  const passed = plan.participants.filter(item => item.result === 'PASSED').length;
  const pendingReview = plan.participants.filter(item => item.reviewStatus === 'PENDING').length;
  return {
    id: plan.id,
    code: plan.code,
    title: plan.title,
    courseId: plan.courseId,
    courseVersion: plan.courseVersion,
    courseSnapshot: plan.courseSnapshot,
    course: plan.course ? serializeTrainingCourse(plan.course) : null,
    purpose: plan.purpose,
    scopeType: plan.scopeType,
    scopeDescription: plan.scopeDescription,
    organizerId: plan.organizerId,
    organizerName: personName(people, plan.organizerId),
    trainerId: plan.trainerId,
    trainerName: personName(people, plan.trainerId),
    reviewerId: plan.reviewerId,
    reviewerName: personName(people, plan.reviewerId),
    departmentId: plan.departmentId,
    startAt: plan.startAt.toISOString(),
    endAt: plan.endAt.toISOString(),
    location: plan.location,
    mode: plan.mode,
    isRequired: plan.isRequired,
    assessmentMode: plan.assessmentMode,
    passScore: plan.passScore,
    status: plan.status,
    version: plan.version,
    publishedAt: plan.publishedAt?.toISOString() || null,
    startedAt: plan.startedAt?.toISOString() || null,
    submittedAt: plan.submittedAt?.toISOString() || null,
    completedAt: plan.completedAt?.toISOString() || null,
    cancelledAt: plan.cancelledAt?.toISOString() || null,
    cancelReason: plan.cancelReason,
    archivedAt: plan.archivedAt?.toISOString() || null,
    archivedById: plan.archivedById,
    archiveReason: plan.archiveReason,
    deletedAt: plan.deletedAt?.toISOString() || null,
    deletedById: plan.deletedById,
    deleteReason: plan.deleteReason,
    restoredAt: plan.restoredAt?.toISOString() || null,
    restoredById: plan.restoredById,
    restoreReason: plan.restoreReason,
    sessions: plan.sessions.map(session => ({
      id: session.id,
      name: session.name,
      sequence: session.sequence,
      startAt: session.startAt.toISOString(),
      endAt: session.endAt.toISOString(),
      location: session.location,
      trainerId: session.trainerId,
      trainerName: personName(people, session.trainerId),
      status: session.status,
      actualStartAt: session.actualStartAt?.toISOString() || null,
      actualEndAt: session.actualEndAt?.toISOString() || null,
      actualMinutes: session.actualMinutes,
      checkInOpenMinutes: session.checkInOpenMinutes,
      lateAfterMinutes: session.lateAfterMinutes,
      checkInCloseMinutes: session.checkInCloseMinutes,
      feedbackDeadlineHours: session.feedbackDeadlineHours,
      feedbackRequired: session.feedbackRequired,
      notes: session.notes,
      version: session.version,
      attachments: session.attachments.map(serializeAttachment),
    })),
    participants: plan.participants.map(participant => ({
      id: participant.id,
      employeeId: participant.employeeId,
      employeeNo: participant.employeeNoSnapshot,
      employeeName: participant.employeeNameSnapshot,
      department: participant.departmentSnapshot,
      position: participant.positionSnapshot,
      team: participant.teamSnapshot,
      employeeActive: participant.employee.isActive,
      isRequired: participant.isRequired,
      attendanceStatus: participant.attendanceStatus,
      checkInAt: participant.checkInAt?.toISOString() || null,
      checkOutAt: participant.checkOutAt?.toISOString() || null,
      actualMinutes: participant.actualMinutes,
      theoryScore: participant.theoryScore,
      practicalScore: participant.practicalScore,
      score: participant.score,
      result: participant.result,
      status: participant.status,
      reviewStatus: participant.reviewStatus,
      reviewerId: participant.reviewerId,
      reviewerName: personName(people, participant.reviewerId),
      reviewComment: participant.reviewComment,
      absenceNote: participant.absenceNote,
      certificationId: participant.certificationId,
      version: participant.version,
      attachments: participant.attachments.map(serializeAttachment),
    })),
    attachments: plan.attachments.map(serializeAttachment),
    activities: plan.activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      fromStatus: activity.fromStatus,
      toStatus: activity.toStatus,
      content: activity.content,
      detail: activity.detail,
      actorId: activity.actorId,
      createdAt: activity.createdAt.toISOString(),
    })),
    summary: {
      participantCount: plan.participants.length,
      attendedCount: attended,
      attendanceRate: plan.participants.length ? Math.round(attended / plan.participants.length * 100) : 0,
      passedCount: passed,
      passRate: plan.assessmentMode === 'NONE'
        ? null
        : (attended ? Math.round(passed / attended * 100) : null),
      pendingReviewCount: pendingReview,
      belowPassCount: plan.participants.filter(item => item.score !== null && item.score < passScore).length,
    },
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function summarizeTraining(plans: ReturnType<typeof serializeTrainingPlan>[], courses: ReturnType<typeof serializeTrainingCourse>[]) {
  const now = Date.now();
  const currentPlans = plans.filter(plan => !plan.archivedAt);
  const upcoming = currentPlans.filter(plan => ['DRAFT', 'PUBLISHED'].includes(plan.status) && new Date(plan.startAt).getTime() >= now);
  const active = currentPlans.filter(plan => ['PUBLISHED', 'IN_PROGRESS'].includes(plan.status));
  const completed = currentPlans.filter(plan => plan.status === 'COMPLETED');
  const reportingPlans = currentPlans.filter(plan => plan.status !== 'CANCELLED');
  const allParticipants = reportingPlans.flatMap(plan => plan.participants);
  const assessedParticipants = reportingPlans
    .filter(plan => plan.assessmentMode !== 'NONE')
    .flatMap(plan => plan.participants);
  const attended = allParticipants.filter(item => ['PRESENT', 'LATE'].includes(item.attendanceStatus));
  const assessedAttended = assessedParticipants.filter(item => ['PRESENT', 'LATE'].includes(item.attendanceStatus));
  const passed = assessedAttended.filter(item => item.result === 'PASSED');
  return {
    activeCourseCount: courses.filter(course => course.status === 'ACTIVE').length,
    upcomingPlanCount: upcoming.length,
    activePlanCount: active.length,
    pendingReviewCount: allParticipants.filter(item => item.reviewStatus === 'PENDING').length,
    completedPlanCount: completed.length,
    participantCount: allParticipants.length,
    attendanceRate: allParticipants.length ? Math.round(attended.length / allParticipants.length * 100) : 0,
    passRate: assessedAttended.length ? Math.round(passed.length / assessedAttended.length * 100) : null,
  };
}
