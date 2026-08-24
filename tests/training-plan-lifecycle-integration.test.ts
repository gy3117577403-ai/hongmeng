import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  readTrainingPlanLifecycleImpact,
  trainingPlanCanArchive,
  trainingPlanCanDelete,
  trainingPlanCanUnarchive,
} from '../lib/training-plan-lifecycle';
import { ensureTrainingSessionAttendanceRows } from '../lib/training-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'training plan lifecycle preserves facts across archive and uses optimistic versions for recycle operations',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-TRAINING-LIFECYCLE-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: { username: `${prefix}-ADMIN`, passwordHash: 'integration-test', displayName: '培训生命周期测试', laborRole: 'ADMIN' },
    });
    const employee = await prisma.employee.create({
      data: { employeeNo: `${prefix}-E1`, name: '培训归档员工', department: '测试部', team: '一班', position: '操作员' },
    });
    const startAt = new Date('2030-02-10T01:00:00.000Z');
    const endAt = new Date('2030-02-10T03:00:00.000Z');
    const factualPlan = await prisma.trainingPlan.create({
      data: {
        code: `${prefix}-FACT`,
        title: '归档保留事实回归',
        startAt,
        endAt,
        assessmentMode: 'NONE',
        status: 'IN_PROGRESS',
        createdById: actor.id,
        updatedById: actor.id,
        sessions: { create: { name: '主培训场次', sequence: 1, startAt, endAt, status: 'IN_PROGRESS' } },
        participants: {
          create: {
            employeeId: employee.id,
            employeeNoSnapshot: employee.employeeNo,
            employeeNameSnapshot: employee.name,
            departmentSnapshot: employee.department,
            positionSnapshot: employee.position,
            teamSnapshot: employee.team,
            reviewStatus: 'NOT_REQUIRED',
          },
        },
      },
      include: { sessions: true, participants: true },
    });
    const draft = await prisma.trainingPlan.create({
      data: {
        code: `${prefix}-DRAFT`,
        title: '可恢复草稿回归',
        startAt,
        endAt,
        assessmentMode: 'NONE',
        status: 'DRAFT',
        createdById: actor.id,
        updatedById: actor.id,
        sessions: { create: { name: '主培训场次', sequence: 1, startAt, endAt } },
        participants: {
          create: {
            employeeId: employee.id,
            employeeNoSnapshot: employee.employeeNo,
            employeeNameSnapshot: employee.name,
            departmentSnapshot: employee.department,
            positionSnapshot: employee.position,
            teamSnapshot: employee.team,
            reviewStatus: 'NOT_REQUIRED',
          },
        },
      },
    });

    try {
      await prisma.$transaction(tx => ensureTrainingSessionAttendanceRows(tx, factualPlan.id));
      const attendance = await prisma.trainingSessionAttendance.findFirstOrThrow({
        where: { sessionId: factualPlan.sessions[0].id, participantId: factualPlan.participants[0].id },
      });
      const invitedImpact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, factualPlan.id));
      assert.equal(invitedImpact.hasExecutionFacts, false);

      await prisma.trainingSessionAttendance.update({
        where: { id: attendance.id },
        data: { status: 'PRESENT', checkInAt: startAt, source: 'ADMIN_MANUAL', correctedAt: startAt, correctedById: actor.id, correctionReason: '集成测试签到' },
      });
      await prisma.trainingParticipant.update({
        where: { id: factualPlan.participants[0].id },
        data: { attendanceStatus: 'PRESENT', status: 'PASSED', result: 'PASSED', submittedAt: endAt },
      });
      await prisma.trainingFeedback.create({
        data: {
          sessionId: factualPlan.sessions[0].id,
          participantId: factualPlan.participants[0].id,
          overallRating: 5,
          contentRating: 5,
          trainerRating: 5,
          practicalValueRating: 5,
          issueTags: [],
        },
      });
      const factualImpact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, factualPlan.id));
      assert.equal(factualImpact.attendanceFactCount, 1);
      assert.equal(factualImpact.feedbackCount, 1);
      assert.equal(factualImpact.scoreOrReviewFactCount, 1);
      assert.equal(factualImpact.hasExecutionFacts, true);
      assert.equal(trainingPlanCanDelete('DRAFT', factualImpact), false);

      const archivedAt = new Date('2030-02-11T01:00:00.000Z');
      await prisma.trainingPlan.update({
        where: { id: factualPlan.id },
        data: { status: 'COMPLETED', completedAt: endAt, archivedAt, archivedById: actor.id, archiveReason: '集成测试归档', version: { increment: 1 } },
      });
      const archived = await prisma.trainingPlan.findUniqueOrThrow({
        where: { id: factualPlan.id },
        include: { participants: true, sessions: { include: { attendanceRecords: true, feedbacks: true } } },
      });
      assert.equal(trainingPlanCanArchive(archived.status, archived.archivedAt), false);
      assert.equal(trainingPlanCanUnarchive(archived.status, archived.archivedAt), true);
      assert.equal(archived.participants.length, 1);
      assert.equal(archived.sessions[0].attendanceRecords.length, 1);
      assert.equal(archived.sessions[0].feedbacks.length, 1);

      const draftImpact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, draft.id));
      assert.equal(trainingPlanCanDelete(draft.status, draftImpact), true);
      const concurrent = await Promise.all([
        prisma.trainingPlan.updateMany({ where: { id: draft.id, version: draft.version, deletedAt: null }, data: { deletedAt: archivedAt, deletedById: actor.id, deleteReason: '并发删除 A', version: { increment: 1 } } }),
        prisma.trainingPlan.updateMany({ where: { id: draft.id, version: draft.version, deletedAt: null }, data: { deletedAt: archivedAt, deletedById: actor.id, deleteReason: '并发删除 B', version: { increment: 1 } } }),
      ]);
      assert.deepEqual(concurrent.map(item => item.count).sort(), [0, 1]);
      const deleted = await prisma.trainingPlan.findUniqueOrThrow({ where: { id: draft.id } });
      const restored = await prisma.trainingPlan.updateMany({
        where: { id: draft.id, version: deleted.version, deletedAt: deleted.deletedAt },
        data: { deletedAt: null, deletedById: null, deleteReason: null, restoredAt: archivedAt, restoredById: actor.id, restoreReason: '并发删除回归后恢复', version: { increment: 1 } },
      });
      assert.equal(restored.count, 1);
    } finally {
      await prisma.trainingPlan.deleteMany({ where: { id: { in: [factualPlan.id, draft.id] } } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
    }
  },
);
