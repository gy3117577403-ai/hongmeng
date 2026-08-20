import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addTrainingMonths,
  calculateTrainingScore,
  nextTrainingPlanStatus,
  parseCourseInput,
  parsePlanInput,
  TrainingInputError,
} from '../lib/training';

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
  assert.throws(() => parsePlanInput({
    title: '反向时间',
    startAt: '2026-08-22T10:00:00+08:00',
    endAt: '2026-08-22T08:00:00+08:00',
  }), /结束时间必须晚于开始时间/);
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
