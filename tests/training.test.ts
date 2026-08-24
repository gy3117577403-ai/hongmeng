import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addTrainingMonths,
  calculateTrainingScore,
  isFormalTrainingRecord,
  nextTrainingPlanStatus,
  parseCourseInput,
  parsePlanInput,
  TrainingInputError,
} from '../lib/training';
import {
  diffTrainingPlanChange,
  trainingPlanCanArchive,
  trainingPlanCanDelete,
  trainingPlanCanUnarchive,
  type TrainingPlanLifecycleImpact,
} from '../lib/training-plan-lifecycle';

test('training plan lifecycle is explicit and blocks invalid jumps', () => {
  assert.equal(nextTrainingPlanStatus('DRAFT', 'publish'), 'PUBLISHED');
  assert.equal(nextTrainingPlanStatus('PUBLISHED', 'start'), 'IN_PROGRESS');
  assert.equal(nextTrainingPlanStatus('IN_PROGRESS', 'submit_review'), 'PENDING_REVIEW');
  assert.equal(nextTrainingPlanStatus('PENDING_REVIEW', 'complete'), 'COMPLETED');
  assert.equal(nextTrainingPlanStatus('DRAFT', 'cancel'), 'CANCELLED');
  assert.throws(() => nextTrainingPlanStatus('DRAFT', 'complete'), TrainingInputError);
});

test('training score follows the configured assessment mode', () => {
  assert.equal(calculateTrainingScore({ mode: 'NONE', theoryScore: 90, practicalScore: 90 }), null);
  assert.equal(calculateTrainingScore({ mode: 'THEORY', theoryScore: 82, practicalScore: null }), 82);
  assert.equal(calculateTrainingScore({ mode: 'PRACTICAL', theoryScore: null, practicalScore: 91 }), 91);
  assert.equal(calculateTrainingScore({ mode: 'COMBINED', theoryScore: 81, practicalScore: 90 }), 86);
  assert.equal(calculateTrainingScore({ mode: 'COMBINED', theoryScore: 81, practicalScore: null }), null);
});

test('training inputs normalize participants and require a valid time window', () => {
  const plan = parsePlanInput({
    title: '  压接机安全培训  ',
    startAt: '2026-08-22T08:00:00+08:00',
    endAt: '2026-08-22T10:00:00+08:00',
    participantIds: ['employee-1', 'employee-1', ' employee-2 '],
    assessmentMode: 'COMBINED',
    passScore: 80,
  });
  assert.equal(plan.title, '压接机安全培训');
  assert.deepEqual(plan.participantIds, ['employee-1', 'employee-2']);
  assert.equal(plan.passScore, 80);
  assert.deepEqual({
    open: plan.checkInOpenMinutes,
    late: plan.lateAfterMinutes,
    close: plan.checkInCloseMinutes,
    feedbackHours: plan.feedbackDeadlineHours,
    feedbackRequired: plan.feedbackRequired,
  }, { open: 30, late: 5, close: 15, feedbackHours: 24, feedbackRequired: false });
  assert.throws(() => parsePlanInput({
    title: '反向时间',
    startAt: '2026-08-22T10:00:00+08:00',
    endAt: '2026-08-22T08:00:00+08:00',
  }), /结束时间必须晚于开始时间/);
  assert.throws(() => parsePlanInput({
    title: '错误签到窗口',
    startAt: '2026-08-22T08:00:00+08:00',
    endAt: '2026-08-22T10:00:00+08:00',
    lateAfterMinutes: 20,
    checkInCloseMinutes: 10,
  }), /签到截止分钟不能早于迟到宽限分钟/);
});

test('course assessment rules and certificate month arithmetic stay deterministic', () => {
  const course = parseCourseInput({ name: '岗位基础', assessmentMode: 'NONE', passScore: 100 });
  assert.equal(course.passScore, null);
  assert.equal(course.defaultDurationMinutes, 60);
  assert.equal(addTrainingMonths(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString().slice(0, 10), '2026-02-28');
});

test('training migration allows approved records to become formal skill certificates', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/202608210001_training_development/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /employee_skill_certifications_source_check/);
  assert.match(migration, /'ASSESSMENT', 'LEGACY_ENTRY', 'TRAINING'/);
});

test('no-assessment completion becomes a formal attendance record without manufacturing a zero pass rate', () => {
  assert.equal(isFormalTrainingRecord({
    planStatus: 'COMPLETED',
    assessmentMode: 'NONE',
    attendanceStatus: 'PRESENT',
    result: 'PASSED',
    reviewStatus: 'NOT_REQUIRED',
  }), true);
  assert.equal(isFormalTrainingRecord({
    planStatus: 'COMPLETED',
    assessmentMode: 'NONE',
    attendanceStatus: 'LEAVE',
    result: 'PENDING',
    reviewStatus: 'NOT_REQUIRED',
  }), false);
  assert.equal(isFormalTrainingRecord({
    planStatus: 'IN_PROGRESS',
    assessmentMode: 'NONE',
    attendanceStatus: 'PRESENT',
    result: 'PASSED',
    reviewStatus: 'NOT_REQUIRED',
  }), false);
});

test('published-plan impact preview locks course standards while allowing controlled schedule changes', () => {
  const current = {
    title: '岗位培训',
    courseId: 'course-1',
    purpose: '原目的',
    organizerId: 'employee-1',
    trainerId: 'employee-2',
    reviewerId: null,
    departmentId: null,
    startAt: new Date('2026-08-25T01:00:00.000Z'),
    endAt: new Date('2026-08-25T03:00:00.000Z'),
    location: '培训室 A',
    mode: 'OFFLINE',
    isRequired: true,
    assessmentMode: 'THEORY',
    passScore: 80,
  };
  const next = parsePlanInput({
    ...current,
    startAt: '2026-08-25T02:00:00.000Z',
    endAt: '2026-08-25T04:00:00.000Z',
    location: '培训室 B',
    passScore: 85,
    participantIds: ['employee-1', 'employee-3'],
    checkInOpenMinutes: 30,
    lateAfterMinutes: 5,
    checkInCloseMinutes: 15,
    feedbackDeadlineHours: 24,
  });
  const fields = diffTrainingPlanChange({
    current,
    currentSession: {
      checkInOpenMinutes: 30,
      lateAfterMinutes: 5,
      checkInCloseMinutes: 15,
      feedbackDeadlineHours: 24,
      feedbackRequired: false,
    },
    next,
    currentParticipantIds: ['employee-1', 'employee-2'],
  });
  assert.equal(fields.find(field => field.key === 'passScore')?.lockedAfterPublish, true);
  assert.equal(fields.find(field => field.key === 'startAt')?.scheduleSensitive, true);
  assert.equal(fields.find(field => field.key === 'participantIds')?.label, '参训人员');
});

test('archive, unarchive and reversible-delete eligibility keep business status separate', () => {
  const emptyImpact: TrainingPlanLifecycleImpact = {
    participantCount: 3,
    attendanceFactCount: 0,
    feedbackCount: 0,
    scoreOrReviewFactCount: 0,
    certificationCount: 0,
    activeQrWindowCount: 0,
    attachmentCount: 1,
    hasExecutionFacts: false,
  };
  assert.equal(trainingPlanCanDelete('DRAFT', emptyImpact), true);
  assert.equal(trainingPlanCanDelete('PUBLISHED', emptyImpact), false);
  assert.equal(trainingPlanCanDelete('DRAFT', { ...emptyImpact, attendanceFactCount: 1, hasExecutionFacts: true }), false);
  assert.equal(trainingPlanCanArchive('COMPLETED', null), true);
  assert.equal(trainingPlanCanArchive('IN_PROGRESS', null), false);
  assert.equal(trainingPlanCanUnarchive('CANCELLED', '2026-08-24T01:00:00.000Z'), true);
});

test('training plan lifecycle migration records archive, deletion and restoration metadata', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/202608240003_training_plan_lifecycle_management/migration.sql', import.meta.url),
    'utf8',
  );
  for (const column of ['archived_at', 'archived_by_id', 'archive_reason', 'deleted_by_id', 'delete_reason', 'restored_at', 'restored_by_id', 'restore_reason']) {
    assert.match(migration, new RegExp(`"${column}"`));
  }
});
