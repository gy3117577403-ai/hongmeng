import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parsePlanInput, TrainingInputError } from '@/lib/training';

type TrainingLifecycleDb = Pick<
  Prisma.TransactionClient,
  | 'trainingPlan'
  | 'trainingParticipant'
  | 'trainingSessionAttendance'
  | 'trainingFeedback'
  | 'trainingQrWindow'
  | 'trainingAttachment'
>;

export type TrainingPlanLifecycleImpact = {
  participantCount: number;
  attendanceFactCount: number;
  feedbackCount: number;
  scoreOrReviewFactCount: number;
  certificationCount: number;
  activeQrWindowCount: number;
  attachmentCount: number;
  hasExecutionFacts: boolean;
};

export async function readTrainingPlanLifecycleImpact(
  db: TrainingLifecycleDb,
  planId: string,
): Promise<TrainingPlanLifecycleImpact> {
  const [
    participantCount,
    attendanceFactCount,
    feedbackCount,
    scoreOrReviewFactCount,
    certificationCount,
    activeQrWindowCount,
    attachmentCount,
  ] = await Promise.all([
    db.trainingParticipant.count({ where: { planId } }),
    db.trainingSessionAttendance.count({
      where: {
        participant: { planId },
        OR: [
          { status: { not: 'INVITED' } },
          { checkInAt: { not: null } },
          { checkOutAt: { not: null } },
          { correctedAt: { not: null } },
        ],
      },
    }),
    db.trainingFeedback.count({ where: { participant: { planId } } }),
    db.trainingParticipant.count({
      where: {
        planId,
        OR: [
          { theoryScore: { not: null } },
          { practicalScore: { not: null } },
          { score: { not: null } },
          { submittedAt: { not: null } },
          { reviewStatus: { in: ['PENDING', 'APPROVED', 'RETURNED'] } },
        ],
      },
    }),
    db.trainingParticipant.count({ where: { planId, certificationId: { not: null } } }),
    db.trainingQrWindow.count({
      where: { session: { planId }, status: { in: ['SCHEDULED', 'OPEN'] } },
    }),
    db.trainingAttachment.count({
      where: {
        deletedAt: null,
        OR: [
          { planId },
          { session: { planId } },
          { participant: { planId } },
        ],
      },
    }),
  ]);
  return {
    participantCount,
    attendanceFactCount,
    feedbackCount,
    scoreOrReviewFactCount,
    certificationCount,
    activeQrWindowCount,
    attachmentCount,
    hasExecutionFacts: attendanceFactCount > 0
      || feedbackCount > 0
      || scoreOrReviewFactCount > 0
      || certificationCount > 0,
  };
}

export function trainingPlanCanArchive(status: string, archivedAt: Date | string | null): boolean {
  return ['COMPLETED', 'CANCELLED'].includes(status) && !archivedAt;
}

export function trainingPlanCanUnarchive(status: string, archivedAt: Date | string | null): boolean {
  return ['COMPLETED', 'CANCELLED'].includes(status) && Boolean(archivedAt);
}

export function trainingPlanCanDelete(status: string, impact: TrainingPlanLifecycleImpact): boolean {
  return status === 'DRAFT' && !impact.hasExecutionFacts;
}

type ComparablePlan = {
  title: string;
  courseId: string | null;
  purpose: string | null;
  organizerId: string | null;
  trainerId: string | null;
  reviewerId: string | null;
  departmentId: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  mode: string;
  isRequired: boolean;
  assessmentMode: string;
  passScore: number | null;
};

type ComparableSession = {
  checkInOpenMinutes: number;
  lateAfterMinutes: number;
  checkInCloseMinutes: number;
  feedbackDeadlineHours: number;
  feedbackRequired: boolean;
} | null;

export type TrainingPlanChangedField = {
  key: string;
  label: string;
  before: string;
  after: string;
  lockedAfterPublish: boolean;
  scheduleSensitive: boolean;
};

function valueText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined || value === '') return '未设置';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function diffTrainingPlanChange(input: {
  current: ComparablePlan;
  currentSession: ComparableSession;
  next: ReturnType<typeof parsePlanInput>;
  currentParticipantIds: readonly string[];
}): TrainingPlanChangedField[] {
  const currentSession = input.currentSession;
  const comparisons: Array<{
    key: string;
    label: string;
    before: unknown;
    after: unknown;
    lockedAfterPublish?: boolean;
    scheduleSensitive?: boolean;
  }> = [
    { key: 'title', label: '计划名称', before: input.current.title, after: input.next.title },
    { key: 'courseId', label: '课程标准', before: input.current.courseId, after: input.next.courseId, lockedAfterPublish: true },
    { key: 'purpose', label: '培训目的', before: input.current.purpose, after: input.next.purpose },
    { key: 'organizerId', label: '组织人', before: input.current.organizerId, after: input.next.organizerId },
    { key: 'trainerId', label: '讲师', before: input.current.trainerId, after: input.next.trainerId, scheduleSensitive: true },
    { key: 'reviewerId', label: '审核人', before: input.current.reviewerId, after: input.next.reviewerId },
    { key: 'departmentId', label: '负责部门', before: input.current.departmentId, after: input.next.departmentId },
    { key: 'startAt', label: '开始时间', before: input.current.startAt, after: input.next.startAt, scheduleSensitive: true },
    { key: 'endAt', label: '结束时间', before: input.current.endAt, after: input.next.endAt, scheduleSensitive: true },
    { key: 'location', label: '培训地点', before: input.current.location, after: input.next.location, scheduleSensitive: true },
    { key: 'mode', label: '培训方式', before: input.current.mode, after: input.next.mode },
    { key: 'isRequired', label: '必修属性', before: input.current.isRequired, after: input.next.isRequired, lockedAfterPublish: true },
    { key: 'assessmentMode', label: '考核方式', before: input.current.assessmentMode, after: input.next.assessmentMode, lockedAfterPublish: true },
    { key: 'passScore', label: '合格分', before: input.current.passScore, after: input.next.passScore, lockedAfterPublish: true },
    { key: 'checkInOpenMinutes', label: '签到开放时间', before: currentSession?.checkInOpenMinutes, after: input.next.checkInOpenMinutes, scheduleSensitive: true },
    { key: 'lateAfterMinutes', label: '迟到宽限', before: currentSession?.lateAfterMinutes, after: input.next.lateAfterMinutes, scheduleSensitive: true },
    { key: 'checkInCloseMinutes', label: '签到截止', before: currentSession?.checkInCloseMinutes, after: input.next.checkInCloseMinutes, scheduleSensitive: true },
    { key: 'feedbackDeadlineHours', label: '反馈截止', before: currentSession?.feedbackDeadlineHours, after: input.next.feedbackDeadlineHours, scheduleSensitive: true },
    { key: 'feedbackRequired', label: '反馈必填', before: currentSession?.feedbackRequired, after: input.next.feedbackRequired, scheduleSensitive: true },
  ];
  const currentParticipantIds = [...new Set(input.currentParticipantIds)].sort();
  const nextParticipantIds = [...new Set(input.next.participantIds)].sort();
  comparisons.push({
    key: 'participantIds',
    label: '参训人员',
    before: currentParticipantIds.join(','),
    after: nextParticipantIds.join(','),
  });
  return comparisons
    .filter(item => valueText(item.before) !== valueText(item.after))
    .map(item => ({
      key: item.key,
      label: item.label,
      before: item.key === 'participantIds' ? `${currentParticipantIds.length} 人` : valueText(item.before),
      after: item.key === 'participantIds' ? `${nextParticipantIds.length} 人` : valueText(item.after),
      lockedAfterPublish: Boolean(item.lockedAfterPublish),
      scheduleSensitive: Boolean(item.scheduleSensitive),
    }));
}

export async function prepareTrainingPlanChange(planId: string, body: Record<string, unknown>) {
  const current = await prisma.trainingPlan.findFirst({
    where: { id: planId, deletedAt: null },
    include: {
      participants: true,
      sessions: { where: { sequence: 1 }, orderBy: { sequence: 'asc' }, take: 1 },
    },
  });
  if (!current) throw new TrainingInputError('培训计划不存在或已删除', 404);
  if (current.archivedAt) throw new TrainingInputError('已归档计划不能变更，请先取消归档', 409);
  if (!['DRAFT', 'PUBLISHED'].includes(current.status)) {
    throw new TrainingInputError('计划开始后不能修改基础安排', 409);
  }
  const mainSession = current.sessions[0] || null;
  if (!mainSession) throw new TrainingInputError('培训计划缺少主场次，不能变更', 409);
  const input = parsePlanInput({
    title: body.title ?? current.title,
    courseId: body.courseId ?? current.courseId,
    purpose: body.purpose ?? current.purpose,
    scopeType: body.scopeType ?? current.scopeType,
    scopeDescription: body.scopeDescription ?? current.scopeDescription,
    organizerId: body.organizerId ?? current.organizerId,
    trainerId: body.trainerId ?? current.trainerId,
    reviewerId: body.reviewerId ?? current.reviewerId,
    departmentId: body.departmentId ?? current.departmentId,
    startAt: body.startAt ?? current.startAt.toISOString(),
    endAt: body.endAt ?? current.endAt.toISOString(),
    location: body.location ?? current.location,
    mode: body.mode ?? current.mode,
    isRequired: body.isRequired ?? current.isRequired,
    assessmentMode: body.assessmentMode ?? current.assessmentMode,
    passScore: body.passScore ?? current.passScore,
    checkInOpenMinutes: body.checkInOpenMinutes ?? mainSession.checkInOpenMinutes,
    lateAfterMinutes: body.lateAfterMinutes ?? mainSession.lateAfterMinutes,
    checkInCloseMinutes: body.checkInCloseMinutes ?? mainSession.checkInCloseMinutes,
    feedbackDeadlineHours: body.feedbackDeadlineHours ?? mainSession.feedbackDeadlineHours,
    feedbackRequired: body.feedbackRequired ?? mainSession.feedbackRequired,
    participantIds: body.participantIds ?? current.participants.map(person => person.employeeId),
  });
  if (!input.participantIds.length) throw new TrainingInputError('请至少选择一名参训人员');
  const expectedVersion = Number(body.version ?? current.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TrainingInputError('计划版本不正确');

  const [employees, course] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: input.participantIds }, isActive: true } }),
    input.courseId
      ? prisma.trainingCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, include: { skill: true } })
      : null,
  ]);
  if (employees.length !== input.participantIds.length) {
    throw new TrainingInputError('参训人员包含离职或不存在的员工', 409);
  }
  if (input.courseId && !course) throw new TrainingInputError('所选课程不存在或已删除', 409);
  if (current.status === 'DRAFT' && body.courseId !== undefined && course) {
    if (body.mode === undefined) input.mode = course.mode as typeof input.mode;
    if (body.isRequired === undefined) input.isRequired = course.isRequired;
    if (body.assessmentMode === undefined) input.assessmentMode = course.assessmentMode as typeof input.assessmentMode;
    if (body.passScore === undefined) input.passScore = input.assessmentMode === 'NONE' ? null : (course.passScore ?? 80);
  }

  const roleEntries = [
    [input.organizerId, '组织人'],
    [input.trainerId, '讲师'],
    [input.reviewerId, '审核人'],
  ] as const;
  const roleIds = [...new Set(roleEntries.map(([id]) => id).filter((id): id is string => Boolean(id)))];
  if (roleIds.length) {
    const activeRoles = new Set((await prisma.employee.findMany({
      where: { id: { in: roleIds }, isActive: true },
      select: { id: true },
    })).map(person => person.id));
    const invalid = roleEntries.find(([id]) => id && !activeRoles.has(id));
    if (invalid) throw new TrainingInputError(`${invalid[1]}不是在岗员工`, 409);
  }

  const currentParticipantIds = current.participants.map(person => person.employeeId);
  const nextParticipantSet = new Set(input.participantIds);
  const currentParticipantSet = new Set(currentParticipantIds);
  const removedParticipantIds = current.participants
    .filter(person => !nextParticipantSet.has(person.employeeId))
    .map(person => person.id);
  const addedEmployeeIds = input.participantIds.filter(id => !currentParticipantSet.has(id));
  const removedFactCount = removedParticipantIds.length
    ? await prisma.trainingParticipant.count({
        where: {
          id: { in: removedParticipantIds },
          OR: [
            { attendanceStatus: { not: 'INVITED' } },
            { checkInAt: { not: null } },
            { checkOutAt: { not: null } },
            { theoryScore: { not: null } },
            { practicalScore: { not: null } },
            { score: { not: null } },
            { submittedAt: { not: null } },
            { reviewStatus: { in: ['PENDING', 'APPROVED', 'RETURNED'] } },
            { certificationId: { not: null } },
            { sessionAttendances: { some: { status: { not: 'INVITED' } } } },
            { feedbacks: { some: {} } },
          ],
        },
      })
    : 0;
  const changedFields = diffTrainingPlanChange({ current, currentSession: mainSession, next: input, currentParticipantIds });
  const blockers: string[] = [];
  if (current.status === 'PUBLISHED') {
    const lockedChanges = changedFields.filter(field => field.lockedAfterPublish);
    if (lockedChanges.length) blockers.push(`计划发布后不能修改：${lockedChanges.map(field => field.label).join('、')}`);
  }
  if (removedFactCount) blockers.push(`有 ${removedFactCount} 名拟移除人员已经产生签到、反馈、成绩或证书事实，不能直接移除`);
  const warnings: string[] = [];
  if (current.status === 'PUBLISHED' && changedFields.length) {
    warnings.push('保存后将记录变更原因，并通知本计划中有个人账号的参训员工');
  }
  if (current.status === 'PUBLISHED' && changedFields.some(field => field.scheduleSensitive)) {
    warnings.push('时间、地点、讲师或签到规则发生变化，现有未关闭二维码将作废，需要重新开放');
  }
  if (removedParticipantIds.length && !removedFactCount) {
    warnings.push(`将移除 ${removedParticipantIds.length} 名尚未产生执行事实的参训人员`);
  }
  if (addedEmployeeIds.length) warnings.push(`将新增 ${addedEmployeeIds.length} 名参训人员并初始化课次签到记录`);
  return {
    current,
    mainSession,
    input,
    expectedVersion,
    employees,
    course,
    changedFields,
    blockers,
    warnings,
    removedParticipantIds,
    addedEmployeeIds,
    requiresConfirmation: current.status === 'PUBLISHED' && changedFields.length > 0,
    scheduleChanged: changedFields.some(field => field.scheduleSensitive),
  };
}
