import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { permanentlyDeleteTrainingPlan, previewTrainingPlanPurge } from '../lib/training-plan-purge';
import { readTrainingLedger } from '../lib/training-ledger';
import type { Prisma } from '@prisma/client';

test('training permanent deletion and Beijing ledger PostgreSQL regression', {
  skip: process.env.RUN_DB_INTEGRATION === '1' ? false : 'requires isolated database',
}, async t => {
  const prefix = 'IT-TRAINING-PURGE-' + randomUUID();
  const actor = await prisma.user.create({ data: { username: prefix, displayName: '隔离培训测试管理员', passwordHash: 'test-only', laborRole: 'ADMIN' } });
  const employee = await prisma.employee.create({ data: { employeeNo: prefix + '-001', name: '时间测试员', department: prefix } });
  const skill = await prisma.skillDefinition.create({ data: { code: prefix, name: '培训测试技能' } });
  const course = await prisma.trainingCourse.create({ data: { code: prefix, name: '保留共享课程', skillId: skill.id } });
  const planIds: string[] = [];
  const fileIds: string[] = [];
  const createPlan = async (extra: Partial<Prisma.TrainingPlanUncheckedCreateInput> = {}) => {
    const plan = await prisma.trainingPlan.create({ data: {
      code: prefix + '-' + planIds.length, title: prefix, courseId: course.id,
      startAt: new Date('2031-08-24T08:30:00Z'), endAt: new Date('2031-08-24T09:00:00Z'),
      status: 'DRAFT', createdById: actor.id, ...extra,
      participants: { create: { employeeId: employee.id, employeeNoSnapshot: '000123', employeeNameSnapshot: employee.name, departmentSnapshot: prefix } },
      sessions: { create: { name: '测试课次', startAt: new Date('2031-08-24T08:30:00Z'), endAt: new Date('2031-08-24T09:00:00Z') } },
    }, include: { sessions: true, participants: true } });
    planIds.push(plan.id); return plan;
  };
  const addFile = async (parent: Partial<Prisma.TrainingAttachmentUncheckedCreateInput>) => {
    const file = await prisma.trainingAttachment.create({ data: {
      objectKey: prefix + '/' + randomUUID(), originalName: 'test.jpg', mimeType: 'image/jpeg', size: 10n, ...parent,
    } }); fileIds.push(file.id); return file;
  };
  const purge = async (plan: { id: string; code: string }, override: Record<string, unknown> = {}) => {
    const preview = await previewTrainingPlanPurge(plan.id);
    return permanentlyDeleteTrainingPlan({ id: plan.id, actorId: actor.id, reason: '隔离测试误录清理',
      confirmationCode: plan.code, confirmed: true, previewToken: preview.previewToken, invalidateFacts: false, ...override });
  };
  try {
    await t.test('cancelled, archived-cancelled and recycled plans are deletable without a retention wait', async () => {
      for (const extra of [
        { status: 'CANCELLED' }, { status: 'CANCELLED', archivedAt: new Date() }, { deletedAt: new Date() },
      ]) {
        const plan = await createPlan(extra);
        assert.equal((await previewTrainingPlanPurge(plan.id)).canPurge, true);
        assert.equal((await purge(plan)).recoverable, false);
        assert.equal(await prisma.trainingPlan.findUnique({ where: { id: plan.id } }), null);
      }
    });
    await t.test('reason, explicit confirmation, exact code and complete preview are checked on the server', async () => {
      const plan = await createPlan();
      await assert.rejects(() => purge(plan, { reason: ' ' }), /原因/);
      await assert.rejects(() => purge(plan, { confirmed: false }), /确认/);
      await assert.rejects(() => purge(plan, { confirmationCode: 'WRONG' }), /编号/);
      const old = await previewTrainingPlanPurge(plan.id);
      await prisma.trainingParticipant.update({ where: { id: plan.participants[0].id }, data: { score: 90 } });
      await assert.rejects(() => purge(plan, { previewToken: old.previewToken, invalidateFacts: true }), /已经变化/);
      await assert.rejects(() => purge(plan), /执行记录/);
      assert.ok(await prisma.trainingPlan.findUnique({ where: { id: plan.id } }));
    });
    await t.test('facts cascade atomically while files, shared course, employee, audit and closed notifications survive correctly', async () => {
      const plan = await createPlan({ status: 'IN_PROGRESS' });
      const session = plan.sessions[0], person = plan.participants[0];
      const qr = await prisma.trainingQrWindow.create({ data: { sessionId: session.id, purpose: 'CHECK_IN',
        tokenHash: randomUUID(), opensAt: new Date('2031-08-24T08:00:00Z'), expiresAt: new Date('2031-08-24T10:00:00Z'), openedById: actor.id } });
      await prisma.trainingSessionAttendance.create({ data: { sessionId: session.id, participantId: person.id, status: 'PRESENT', checkInAt: plan.startAt, qrWindowId: qr.id } });
      await prisma.trainingParticipant.update({ where: { id: person.id }, data: { attendanceStatus: 'PRESENT', actualMinutes: 30, score: 95 } });
      await prisma.trainingFeedback.create({ data: { sessionId: session.id, participantId: person.id, overallRating: 5, contentRating: 5, trainerRating: 5, practicalValueRating: 5, issueTags: [] } });
      const files = [
        await addFile({ planId: plan.id }), await addFile({ sessionId: session.id }),
        await addFile({ participantId: person.id, deletedAt: new Date('2031-08-24T09:00:00Z') }),
      ];
      const shared = await addFile({ courseId: course.id });
      const notification = await prisma.systemNotification.create({ data: {
        eventType: 'training_plan', dedupeKey: prefix, title: 'QA', sourceType: 'training_plan', sourceId: plan.id, targetRoute: '/workspace/employees?view=training',
      } });
      const preview = await previewTrainingPlanPurge(plan.id);
      assert.equal(preview.impact.attachmentCount, 3);
      assert.equal(preview.impact.feedbackCount, 1);
      assert.equal(preview.impact.activeQrWindowCount, 1);
      await assert.rejects(() => purge(plan), /执行记录/);
      await purge(plan, { invalidateFacts: true });
      for (const file of files) {
        const retained = await prisma.trainingAttachment.findUniqueOrThrow({ where: { id: file.id } });
        assert.ok(retained.deletedAt); assert.equal(retained.planId, null); assert.equal(retained.sessionId, null); assert.equal(retained.participantId, null);
        assert.equal(retained.objectKey, file.objectKey);
        assert.equal((retained.sourceSnapshot as { planId: string }).planId, plan.id);
      }
      assert.equal((await prisma.trainingAttachment.findUniqueOrThrow({ where: { id: shared.id } })).deletedAt, null);
      assert.ok(await prisma.trainingCourse.findUnique({ where: { id: course.id } }));
      assert.ok(await prisma.employee.findUnique({ where: { id: employee.id } }));
      assert.equal(await prisma.trainingSession.count({ where: { planId: plan.id } }), 0);
      assert.equal(await prisma.trainingParticipant.count({ where: { planId: plan.id } }), 0);
      assert.equal(await prisma.trainingSessionAttendance.count({ where: { sessionId: session.id } }), 0);
      assert.equal(await prisma.trainingFeedback.count({ where: { sessionId: session.id } }), 0);
      assert.equal(await prisma.trainingQrWindow.findUnique({ where: { id: qr.id } }), null);
      const expired = await prisma.systemNotification.findUniqueOrThrow({ where: { id: notification.id } });
      assert.ok(expired.expiresAt); assert.equal(expired.targetRoute, null);
      assert.equal(await prisma.operationLog.count({ where: { targetId: plan.id, action: 'permanently_delete_training_plan' } }), 1);
      await assert.rejects(() => addFile({}), /constraint/i);
    });
    await t.test('active certifications block deletion and revoked shared certifications are never deleted', async () => {
      const plan = await createPlan({ status: 'COMPLETED', archivedAt: new Date() });
      const cert = await prisma.employeeSkillCertification.create({ data: { employeeId: employee.id, skillId: skill.id, level: 1, source: 'TRAINING' } });
      await prisma.trainingParticipant.update({ where: { id: plan.participants[0].id }, data: { certificationId: cert.id } });
      assert.equal((await previewTrainingPlanPurge(plan.id)).canPurge, false);
      await assert.rejects(() => purge(plan, { invalidateFacts: true }), /证书/);
      assert.equal((await prisma.employeeSkillCertification.findUniqueOrThrow({ where: { id: cert.id } })).status, 'ACTIVE');
      await prisma.employeeSkillCertification.update({ where: { id: cert.id }, data: { status: 'REVOKED' } });
      await purge(plan, { invalidateFacts: true });
      assert.ok(await prisma.employeeSkillCertification.findUnique({ where: { id: cert.id } }));
    });
    await t.test('two concurrent purges cannot create two audit entries or a partially deleted plan', async () => {
      const plan = await createPlan();
      const preview = await previewTrainingPlanPurge(plan.id);
      const input = { id: plan.id, actorId: actor.id, reason: '并发误录清理', confirmationCode: plan.code, confirmed: true, previewToken: preview.previewToken, invalidateFacts: false };
      const results = await Promise.allSettled([permanentlyDeleteTrainingPlan(input), permanentlyDeleteTrainingPlan(input)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(await prisma.operationLog.count({ where: { targetId: plan.id, action: 'permanently_delete_training_plan' } }), 1);
    });
    await t.test('ledger uses Beijing start date inclusive-end and includes archived completed only', async () => {
      const early = await createPlan({ status: 'COMPLETED', startAt: new Date('2031-08-23T16:00:00Z') });
      const late = await createPlan({ status: 'COMPLETED', archivedAt: new Date(), startAt: new Date('2031-08-24T15:59:59Z'), endAt: new Date('2031-08-24T16:30:00Z') });
      await createPlan({ status: 'COMPLETED', startAt: new Date('2031-08-24T16:00:00Z'), endAt: new Date('2031-08-24T17:00:00Z') });
      await createPlan({ status: 'COMPLETED', startAt: new Date('2031-08-23T15:59:59Z') });
      await createPlan({ status: 'CANCELLED' }); await createPlan({ status: 'DRAFT' });
      await createPlan({ status: 'COMPLETED', deletedAt: new Date() });
      const query = new URLSearchParams({ period: 'custom', startDate: '2031-08-24', endDate: '2031-08-24', planKeyword: prefix });
      const ledger = await readTrainingLedger(query);
      assert.deepEqual(ledger.rows.map(row => row.planCode), [early.code, late.code]);
      assert.equal(ledger.employeeCount, 1); assert.equal(ledger.planCount, 2);
      assert.equal(ledger.rows[0].actualMinutes, null);
      query.set('department', 'missing'); assert.equal((await readTrainingLedger(query)).rows.length, 0);
      query.set('department', prefix); query.set('employee', '000123');
      assert.equal((await readTrainingLedger(query)).rows.length, 2);
      assert.equal((await readTrainingLedger(new URLSearchParams({ planId: late.id }))).rows.length, 1);
    });
  } finally {
    await prisma.trainingAttachment.deleteMany({ where: { id: { in: fileIds } } });
    await prisma.operationLog.deleteMany({ where: { targetId: { in: planIds } } });
    await prisma.systemNotification.deleteMany({ where: { sourceId: { in: planIds } } });
    await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.trainingCourse.delete({ where: { id: course.id } });
    await prisma.employeeSkillCertification.deleteMany({ where: { employeeId: employee.id } });
    await prisma.skillDefinition.delete({ where: { id: skill.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
