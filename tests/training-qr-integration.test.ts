import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  checkInTrainingSelf,
  createTrainingQrWindow,
  ensureTrainingSessionAttendanceRows,
  resolveTrainingSelfScan,
  startTrainingSession,
  submitTrainingFeedbackSelf,
  trainingPlanAccountReadiness,
  trainingSessionLive,
  updateTrainingSessionAttendance,
} from '../lib/training-qr-service';
import { TrainingQrError } from '../lib/training-qr';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'personal-account QR check-in, session finalization and feedback stay synchronized without manufacturing checkout facts',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-TRAINING-QR-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const previousSecret = process.env.TRAINING_QR_SIGNING_SECRET;
    process.env.TRAINING_QR_SIGNING_SECRET = `${prefix}-signing-secret-with-at-least-thirty-two-bytes`;
    const actor = await prisma.user.create({
      data: { username: `${prefix}-ADMIN`, passwordHash: 'integration-test', displayName: `${prefix} admin`, laborRole: 'ADMIN' },
    });
    const employeeA = await prisma.employee.create({
      data: { employeeNo: `${prefix}-E1`, name: '二维码员工甲', department: '测试部', team: '一班', position: '操作员' },
    });
    const employeeB = await prisma.employee.create({
      data: { employeeNo: `${prefix}-E2`, name: '二维码员工乙', department: '测试部', team: '一班', position: '操作员' },
    });
    const outsider = await prisma.employee.create({
      data: { employeeNo: `${prefix}-E3`, name: '非参训员工', department: '测试部', team: '二班', position: '操作员' },
    });
    const participantUsers = await Promise.all([
      prisma.user.create({ data: { username: `${prefix}-U1`, passwordHash: 'integration-test', displayName: '二维码员工甲', employeeId: employeeA.id } }),
      prisma.user.create({ data: { username: `${prefix}-U2`, passwordHash: 'integration-test', displayName: '二维码员工乙', employeeId: employeeB.id } }),
      prisma.user.create({ data: { username: `${prefix}-U3`, passwordHash: 'integration-test', displayName: '非参训员工', employeeId: outsider.id } }),
    ]);
    const sessionStart = new Date('2030-01-10T01:00:00.000Z');
    const sessionEnd = new Date('2030-01-10T02:00:00.000Z');
    const futureSessionStart = new Date('2030-01-11T01:00:00.000Z');
    const futureSessionEnd = new Date('2030-01-11T02:00:00.000Z');
    const plan = await prisma.trainingPlan.create({
      data: {
        code: `${prefix}-PLAN`,
        title: '二维码与反馈数据库回归',
        startAt: sessionStart,
        endAt: futureSessionEnd,
        mode: 'OFFLINE',
        assessmentMode: 'NONE',
        status: 'PUBLISHED',
        createdById: actor.id,
        updatedById: actor.id,
        sessions: {
          create: [{
            name: '主培训课次',
            sequence: 1,
            startAt: sessionStart,
            endAt: sessionEnd,
            location: '测试培训室',
            status: 'SCHEDULED',
          }, {
            name: '后续培训课次',
            sequence: 2,
            startAt: futureSessionStart,
            endAt: futureSessionEnd,
            location: '测试培训室',
            status: 'SCHEDULED',
          }],
        },
        participants: {
          create: [employeeA, employeeB].map(employee => ({
            employeeId: employee.id,
            employeeNoSnapshot: employee.employeeNo,
            employeeNameSnapshot: employee.name,
            departmentSnapshot: employee.department,
            positionSnapshot: employee.position,
            teamSnapshot: employee.team,
            reviewStatus: 'NOT_REQUIRED',
          })),
        },
      },
      include: { sessions: true, participants: true },
    });
    const session = plan.sessions.find(item => item.sequence === 1)!;
    const futureSession = plan.sessions.find(item => item.sequence === 2)!;
    const participantA = plan.participants.find(participant => participant.employeeId === employeeA.id)!;
    const participantB = plan.participants.find(participant => participant.employeeId === employeeB.id)!;

    try {
      await prisma.$transaction(tx => ensureTrainingSessionAttendanceRows(tx, plan.id));
      const readiness = await trainingPlanAccountReadiness(plan.id);
      assert.equal(readiness.readyCount, 2);
      assert.equal(readiness.blockedCount, 0);

      const started = await startTrainingSession({
        sessionId: session.id,
        actorId: actor.id,
        expectedVersion: session.version,
        now: new Date('2030-01-10T00:50:00.000Z'),
      });
      assert.equal(started.idempotent, false);
      assert.equal(started.session.status, 'IN_PROGRESS');
      assert.equal((await prisma.trainingPlan.findUniqueOrThrow({ where: { id: plan.id } })).status, 'IN_PROGRESS');
      assert.equal((await prisma.trainingSession.findUniqueOrThrow({ where: { id: futureSession.id } })).status, 'SCHEDULED');

      const checkInNow = new Date('2030-01-10T00:55:00.000Z');
      const opened = await createTrainingQrWindow({
        sessionId: session.id,
        purpose: 'CHECK_IN',
        actorId: actor.id,
        now: checkInNow,
      });
      assert.equal(opened.window.status, 'OPEN');
      assert.equal(opened.window.generation, 1);

      const firstCheckIn = await checkInTrainingSelf({ code: opened.code, employeeId: employeeA.id, now: checkInNow });
      assert.equal(firstCheckIn.attendance?.status, 'PRESENT');
      assert.equal(firstCheckIn.idempotent, false);
      const duplicate = await checkInTrainingSelf({ code: opened.code, employeeId: employeeA.id, now: new Date(checkInNow.getTime() + 10_000) });
      assert.equal(duplicate.idempotent, true);
      assert.equal(await prisma.trainingSessionAttendance.count({ where: { sessionId: session.id, participantId: participantA.id } }), 1);

      await assert.rejects(
        resolveTrainingSelfScan({ code: opened.code, employeeId: outsider.id, now: checkInNow }),
        (error: unknown) => error instanceof TrainingQrError
          && error.code === 'TRAINING_PARTICIPANT_NOT_INVITED'
          && error.statusCode === 403,
      );

      const feedbackNow = new Date('2030-01-10T02:00:00.000Z');
      const feedbackWindow = await createTrainingQrWindow({
        sessionId: session.id,
        purpose: 'FEEDBACK',
        actorId: actor.id,
        now: feedbackNow,
      });
      const autoAbsent = await prisma.trainingSessionAttendance.findUniqueOrThrow({
        where: { sessionId_participantId: { sessionId: session.id, participantId: participantB.id } },
      });
      assert.equal(autoAbsent.status, 'ABSENT');
      assert.equal(autoAbsent.source, 'SYSTEM_FINALIZE');
      assert.equal(autoAbsent.correctionReason, '课次结束时仍未签到');
      await assert.rejects(
        submitTrainingFeedbackSelf({
          code: feedbackWindow.code,
          employeeId: employeeB.id,
          now: new Date(feedbackNow.getTime() + 30_000),
          body: {
            overallRating: 5,
            contentRating: 5,
            trainerRating: 5,
            practicalValueRating: 5,
            issueTags: [],
            comment: '',
            followUpRequested: false,
          },
        }),
        (error: unknown) => error instanceof TrainingQrError
          && error.code === 'TRAINING_FEEDBACK_ATTENDANCE_REQUIRED',
      );

      const feedback = await submitTrainingFeedbackSelf({
        code: feedbackWindow.code,
        employeeId: employeeA.id,
        now: new Date(feedbackNow.getTime() + 60_000),
        body: {
          overallRating: 5,
          contentRating: 4,
          trainerRating: 5,
          practicalValueRating: 5,
          issueTags: ['案例不足'],
          comment: '建议增加现场案例',
          followUpRequested: true,
        },
      });
      assert.equal(feedback.feedback?.overallRating, 5);
      const attendanceAfterFeedback = await prisma.trainingSessionAttendance.findUniqueOrThrow({
        where: { sessionId_participantId: { sessionId: session.id, participantId: participantA.id } },
      });
      assert.equal(attendanceAfterFeedback.status, 'PRESENT');
      assert.equal(attendanceAfterFeedback.checkOutAt, null);
      const planParticipantAfterFeedback = await prisma.trainingParticipant.findUniqueOrThrow({ where: { id: participantA.id } });
      assert.equal(planParticipantAfterFeedback.attendanceStatus, 'PARTIAL');
      assert.equal(planParticipantAfterFeedback.checkOutAt, null);
      const live = await trainingSessionLive(session.id, new Date(feedbackNow.getTime() + 90_000));
      assert.equal(live.summary.feedbackEligibleCount, 1);
      assert.equal(live.summary.feedbackRate, 100);

      await assert.rejects(
        submitTrainingFeedbackSelf({
          code: feedbackWindow.code,
          employeeId: employeeA.id,
          now: new Date(feedbackNow.getTime() + 120_000),
          body: {
            overallRating: 4,
            contentRating: 4,
            trainerRating: 4,
            practicalValueRating: 4,
            issueTags: [],
            comment: '',
            followUpRequested: false,
            version: 999,
          },
        }),
        (error: unknown) => error instanceof TrainingQrError && error.code === 'TRAINING_FEEDBACK_CONFLICT',
      );

      await assert.rejects(
        updateTrainingSessionAttendance({
          attendanceId: autoAbsent.id,
          status: 'LEAVE',
          expectedVersion: autoAbsent.version + 1,
          reason: '事假',
          actorId: actor.id,
          now: new Date(feedbackNow.getTime() + 180_000),
        }),
        (error: unknown) => error instanceof TrainingQrError && error.code === 'TRAINING_ATTENDANCE_CONFLICT',
      );
      const corrected = await updateTrainingSessionAttendance({
        attendanceId: autoAbsent.id,
        status: 'LEAVE',
        expectedVersion: autoAbsent.version,
        reason: '已核实为事假',
        actorId: actor.id,
        now: new Date(feedbackNow.getTime() + 240_000),
      });
      assert.equal(corrected.status, 'LEAVE');
      assert.equal(corrected.source, 'ADMIN_MANUAL');
      assert.equal(corrected.correctionReason, '已核实为事假');

      const rotated = await createTrainingQrWindow({
        sessionId: session.id,
        purpose: 'FEEDBACK',
        actorId: actor.id,
        now: new Date(feedbackNow.getTime() + 300_000),
      });
      assert.equal(rotated.window.generation, 2);
      await assert.rejects(
        submitTrainingFeedbackSelf({
          code: feedbackWindow.code,
          employeeId: employeeA.id,
          now: new Date(feedbackNow.getTime() + 360_000),
          body: {
            overallRating: 5,
            contentRating: 5,
            trainerRating: 5,
            practicalValueRating: 5,
            issueTags: [],
            comment: '',
            followUpRequested: false,
            version: feedback.feedback?.version,
          },
        }),
        (error: unknown) => error instanceof TrainingQrError && error.code === 'TRAINING_FEEDBACK_CLOSED',
      );
    } finally {
      await prisma.trainingPlan.deleteMany({ where: { id: plan.id } });
      await prisma.systemNotification.deleteMany({
        where: { OR: [{ sourceId: plan.id }, { sourceId: session.id }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: [actor.id, ...participantUsers.map(user => user.id)] } } });
      await prisma.employee.deleteMany({ where: { id: { in: [employeeA.id, employeeB.id, outsider.id] } } });
      if (previousSecret === undefined) delete process.env.TRAINING_QR_SIGNING_SECRET;
      else process.env.TRAINING_QR_SIGNING_SECRET = previousSecret;
    }
  },
);
