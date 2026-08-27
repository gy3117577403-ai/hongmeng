import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  createTrainingQrCode,
  hashTrainingQrCode,
  parseTrainingFeedbackInput,
  parseTrainingQrCode,
  trainingCheckInSchedule,
  trainingCheckInStatus,
  TrainingQrError,
  trainingQrTemporalState,
  verifyTrainingQrCode,
} from '../lib/training-qr';
import { createTrainingWorkbook } from '../lib/training-workbook';

const secret = 'training-qr-test-secret-that-is-longer-than-32-bytes';
const qrInput = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  generation: 2,
  sessionId: '660e8400-e29b-41d4-a716-446655440000',
  purpose: 'CHECK_IN' as const,
  secret,
};

test('training QR codes are deterministic, purpose-bound and tamper-evident', () => {
  const code = createTrainingQrCode(qrInput);
  assert.deepEqual(parseTrainingQrCode(code), {
    id: qrInput.id,
    generation: 2,
    signature: code.split('.')[2],
  });
  assert.equal(createTrainingQrCode(qrInput), code);
  assert.equal(verifyTrainingQrCode({ ...qrInput, code, tokenHash: hashTrainingQrCode(code) }), true);

  const replacement = code.endsWith('A') ? 'B' : 'A';
  const tampered = `${code.slice(0, -1)}${replacement}`;
  assert.equal(verifyTrainingQrCode({ ...qrInput, code: tampered, tokenHash: hashTrainingQrCode(code) }), false);
  assert.equal(verifyTrainingQrCode({ ...qrInput, code, tokenHash: hashTrainingQrCode(code), purpose: 'FEEDBACK' }), false);
});

test('training QR temporal boundaries and late threshold use server time exactly', () => {
  const startAt = new Date('2026-08-23T01:00:00.000Z');
  const schedule = trainingCheckInSchedule({
    startAt,
    checkInOpenMinutes: 30,
    lateAfterMinutes: 5,
    checkInCloseMinutes: 15,
  });
  assert.equal(schedule.opensAt.toISOString(), '2026-08-23T00:30:00.000Z');
  assert.equal(schedule.lateAt.toISOString(), '2026-08-23T01:05:00.000Z');
  assert.equal(schedule.expiresAt.toISOString(), '2026-08-23T01:15:00.000Z');
  assert.equal(trainingQrTemporalState({ status: 'OPEN', ...schedule, now: new Date('2026-08-23T00:29:59.999Z') }), 'SCHEDULED');
  assert.equal(trainingQrTemporalState({ status: 'OPEN', ...schedule, now: schedule.opensAt }), 'OPEN');
  assert.equal(trainingQrTemporalState({ status: 'OPEN', ...schedule, now: schedule.expiresAt }), 'EXPIRED');
  assert.equal(trainingQrTemporalState({ status: 'REVOKED', ...schedule, now: schedule.opensAt }), 'REVOKED');
  assert.equal(trainingCheckInStatus({ startAt, lateAfterMinutes: 5, now: new Date('2026-08-23T01:04:59.999Z') }), 'PRESENT');
  assert.equal(trainingCheckInStatus({ startAt, lateAfterMinutes: 5, now: new Date('2026-08-23T01:05:00.000Z') }), 'LATE');
});

test('training feedback accepts only bounded ratings and approved issue tags', () => {
  const parsed = parseTrainingFeedbackInput({
    overallRating: 5,
    contentRating: 4,
    trainerRating: 5,
    practicalValueRating: 3,
    issueTags: ['案例不足', '案例不足', '非法标签', '实操不足'],
    comment: '  希望增加案例演练  ',
    followUpRequested: true,
    version: 2,
  });
  assert.deepEqual(parsed.issueTags, ['案例不足', '实操不足']);
  assert.equal(parsed.comment, '希望增加案例演练');
  assert.equal(parsed.followUpRequested, true);
  assert.equal(parsed.version, 2);
  assert.throws(
    () => parseTrainingFeedbackInput({ overallRating: 6, contentRating: 5, trainerRating: 5, practicalValueRating: 5 }),
    (error: unknown) => error instanceof TrainingQrError && error.code === 'TRAINING_FEEDBACK_INVALID',
  );
});

test('training QR migration preserves only unambiguous single-session history and adds data constraints', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/202608230001_training_qr_attendance_feedback/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /training_session_attendances_session_id_participant_id_key/);
  assert.match(migration, /training_feedbacks_overall_rating_check/);
  assert.match(migration, /training_qr_windows_time_check/);
  assert.match(migration, /HAVING COUNT\(\*\) = 1/);
  assert.match(migration, /'LEGACY_MIGRATION'/);
});

test('training workbook exports one ordinary sheet with Beijing dates even when legacy details are supplied', async () => {
  const startAt = new Date('2026-08-23T01:00:00.000Z');
  const endAt = new Date('2026-08-23T03:00:00.000Z');
  const base = {
    planCode: 'TRP-TEST',
    planStatus: 'COMPLETED',
    planTitle: '安全操作培训',
    courseName: '岗位安全',
    startAt,
    endAt,
    employeeNo: 'E001',
    employeeName: '测试员工',
    department: '生产部',
    team: '一班',
    position: '操作员',
    attendanceStatus: 'PRESENT',
    actualMinutes: 120,
    assessmentMode: 'NONE',
    theoryScore: null,
    practicalScore: null,
    score: null,
    result: 'PENDING',
    reviewStatus: 'NOT_REQUIRED',
    certificationId: null,
  };
  const buffer = await createTrainingWorkbook({
    startDate: '2026-08-23',
    endDate: '2026-08-23',
    generatedAt: '2026-08-23 12:00',
    rows: [base],
    sessionRows: [{
      planCode: base.planCode,
      planTitle: base.planTitle,
      sessionSequence: 1,
      sessionName: '主培训场次',
      sessionStartAt: startAt,
      sessionEndAt: endAt,
      location: '培训室',
      employeeNo: base.employeeNo,
      employeeName: base.employeeName,
      department: base.department,
      team: base.team,
      attendanceStatus: 'PRESENT',
      checkInAt: startAt,
      checkOutAt: null,
      source: 'QR_SELF',
      correctionReason: null,
    }],
    feedbackRows: [{
      planCode: base.planCode,
      planTitle: base.planTitle,
      sessionSequence: 1,
      sessionName: '主培训场次',
      employeeNo: base.employeeNo,
      employeeName: base.employeeName,
      department: base.department,
      team: base.team,
      overallRating: 5,
      contentRating: 4,
      trainerRating: 5,
      practicalValueRating: 5,
      issueTags: ['案例不足'],
      comment: '建议增加演练',
      followUpRequested: true,
      submittedAt: endAt,
      updatedAt: endAt,
    }],
    feedbackSummaries: [{
      planCode: base.planCode,
      planTitle: base.planTitle,
      sessionSequence: 1,
      sessionName: '主培训场次',
      participantCount: 1,
      attendedCount: 1,
      eligibleFeedbackCount: 1,
      feedbackCount: 1,
      feedbackRate: 100,
      averageOverallRating: 5,
      averageContentRating: 4,
      averageTrainerRating: 5,
      averagePracticalValueRating: 5,
      followUpCount: 1,
    }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['培训台账']);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A1').value, '序号');
  assert.equal(sheet.getCell('M2').value, '完成（无需考核）');
  assert.equal(sheet.getCell('J2').value, 2);
  assert.equal((sheet.getCell('D2').value as Date).toISOString(), '2026-08-23T09:00:00.000Z');
  assert.equal((sheet.getCell('E2').value as Date).toISOString(), '2026-08-23T11:00:00.000Z');
  assert.equal(startAt.toISOString(), '2026-08-23T01:00:00.000Z');
});
