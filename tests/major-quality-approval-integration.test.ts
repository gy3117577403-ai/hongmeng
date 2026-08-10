import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import {
  decideMajorQualityApproval,
  loadMajorQualityApprovals,
  MajorQualityApprovalError,
  reviewMajorQualityApproval,
  submitMajorQualityApproval,
} from '../lib/major-quality-approval';
import { prisma } from '../lib/prisma';
import {
  createSystemNotification,
  loadNotificationInbox,
  setNotificationReadState,
} from '../lib/system-notifications';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

function actor(user: { id: string; username: string; displayName: string }, profile: 'QUALITY' | 'GM') {
  const access = profile === 'QUALITY'
    ? resolveAccessContext([{
      profile: 'DEPARTMENT_FULL', departmentCode: 'QUALITY', grantType: 'PRIMARY', scopeKey: 'DEPARTMENT:QUALITY',
    }])
    : resolveAccessContext([{
      profile: 'GM_OFFICE_READER_APPROVER', departmentCode: 'GM_OFFICE', grantType: 'PRIMARY', scopeKey: 'DEPARTMENT:GM_OFFICE',
    }]);
  return { ...user, access };
}

test('major quality approval is transactional, separated by person, and notification reads are isolated', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `major-quality-it-${randomUUID().slice(0, 8)}`;
  const [qualityDepartment, gmDepartment] = await Promise.all([
    prisma.department.findUniqueOrThrow({ where: { code: 'QUALITY' } }),
    prisma.department.findUniqueOrThrow({ where: { code: 'GM_OFFICE' } }),
  ]);
  const users = await Promise.all([
    prisma.user.create({ data: { username: `${prefix}-submitter`, passwordHash: 'integration-test-only', displayName: '质量提交人' } }),
    prisma.user.create({ data: { username: `${prefix}-reviewer`, passwordHash: 'integration-test-only', displayName: '质量复核人' } }),
    prisma.user.create({ data: { username: `${prefix}-gm`, passwordHash: 'integration-test-only', displayName: '总经办终审人' } }),
  ]);
  const [submitter, reviewer, gm] = users;
  let issueId = '';
  let approvalId = '';
  try {
    await prisma.userAccessGrant.createMany({
      data: [
        { userId: submitter.id, profile: 'DEPARTMENT_FULL', departmentId: qualityDepartment.id, scopeKey: 'DEPARTMENT:QUALITY', grantType: 'PRIMARY' },
        { userId: reviewer.id, profile: 'DEPARTMENT_FULL', departmentId: qualityDepartment.id, scopeKey: 'DEPARTMENT:QUALITY', grantType: 'PRIMARY' },
        { userId: gm.id, profile: 'GM_OFFICE_READER_APPROVER', departmentId: gmDepartment.id, scopeKey: 'DEPARTMENT:GM_OFFICE', grantType: 'PRIMARY' },
      ],
    });
    const issue = await prisma.issue.create({
      data: {
        title: `${prefix} 批量端子拉力异常`,
        type: 'quality',
        priority: 'urgent',
        status: 'processing',
        isMajorQuality: true,
        majorQualityReason: '同批次多客户产品存在失效风险',
        solution: '隔离批次并完成全检',
        verificationResult: '复检结果符合要求',
        reporterId: submitter.id,
      },
    });
    issueId = issue.id;
    const submitterActor = actor(submitter, 'QUALITY');
    approvalId = await prisma.$transaction(async tx => {
      await tx.issue.update({ where: { id: issue.id }, data: { status: 'verifying', resolvedAt: new Date(), version: { increment: 1 } } });
      return submitMajorQualityApproval(tx, issue, submitterActor, issue.version + 1);
    });
    const pending = await prisma.issueMajorApproval.findUniqueOrThrow({ where: { id: approvalId } });
    assert.equal(pending.status, 'PENDING_QUALITY_REVIEW');
    const submittedSnapshot = pending.issueSnapshot as { title?: string; issueVersion?: number; attachments?: unknown[] };
    assert.equal(submittedSnapshot.title, issue.title);
    assert.equal(submittedSnapshot.issueVersion, issue.version + 1);
    assert.deepEqual(submittedSnapshot.attachments, []);
    assert.equal(await prisma.systemNotificationRecipient.count({
      where: { userId: reviewer.id, notification: { eventType: 'MAJOR_QUALITY_REVIEW_REQUESTED' } },
    }), 1);

    await assert.rejects(
      reviewMajorQualityApproval(submitterActor, {
        issueId: issue.id,
        approvalId,
        expectedVersion: pending.version,
        decision: 'APPROVE',
        note: '不应允许自审',
      }),
      (error: unknown) => error instanceof MajorQualityApprovalError && error.code === 'MAJOR_QUALITY_SELF_REVIEW',
    );

    const qualityApproved = await reviewMajorQualityApproval(actor(reviewer, 'QUALITY'), {
      issueId: issue.id,
      approvalId,
      expectedVersion: pending.version,
      decision: 'APPROVE',
      note: '隔离、全检和原因分析资料完整，同意提交终审',
    });
    assert.equal(qualityApproved.status, 'PENDING_GM_APPROVAL');
    assert.equal(await prisma.systemNotificationRecipient.count({
      where: { userId: gm.id, notification: { eventType: 'MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED' } },
    }), 1);

    const approved = await decideMajorQualityApproval(actor(gm, 'GM'), {
      issueId: issue.id,
      approvalId,
      expectedVersion: qualityApproved.version,
      decision: 'APPROVE',
      note: '同意质量复核结论，按整改方案闭环',
    });
    assert.equal(approved.status, 'APPROVED');
    const closedIssue = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    assert.equal(closedIssue.status, 'closed');
    assert.ok(closedIssue.closedAt);
    assert.equal(await prisma.issueMajorApprovalEvent.count({ where: { approvalId } }), 3);

    await prisma.issue.update({ where: { id: issue.id }, data: { title: `${prefix} 后续整改标题` } });
    const approvalHistory = await loadMajorQualityApprovals(actor(gm, 'GM'), 'APPROVED');
    const historicalApproval = approvalHistory.approvals.find(item => item.id === approvalId);
    assert.equal(historicalApproval?.issue.title, issue.title);
    assert.equal(historicalApproval?.issue.snapshotVersion, issue.version + 1);

    const reviewerInbox = await loadNotificationInbox(reviewer.id, actor(reviewer, 'QUALITY').access, { limit: 20 });
    const reviewRequest = reviewerInbox.notifications.find(item => item.eventType === 'MAJOR_QUALITY_REVIEW_REQUESTED');
    assert.ok(reviewRequest);
    assert.equal(await setNotificationReadState(submitter.id, reviewRequest!.id, true), false);
    assert.equal(await setNotificationReadState(reviewer.id, reviewRequest!.id, true), true);

    await prisma.$transaction(async tx => {
      await createSystemNotification(tx, {
        eventType: 'INTEGRATION_DEDUPE',
        dedupeKey: `${prefix}:dedupe`,
        category: 'SYSTEM',
        title: '去重验证',
        recipientUserIds: [reviewer.id],
      });
      await createSystemNotification(tx, {
        eventType: 'INTEGRATION_DEDUPE',
        dedupeKey: `${prefix}:dedupe`,
        category: 'SYSTEM',
        title: '去重验证',
        recipientUserIds: [reviewer.id],
      });
    });
    assert.equal(await prisma.systemNotification.count({ where: { dedupeKey: `${prefix}:dedupe` } }), 1);
    assert.equal(await prisma.systemNotificationRecipient.count({
      where: { userId: reviewer.id, notification: { dedupeKey: `${prefix}:dedupe` } },
    }), 1);
  } finally {
    if (issueId) await prisma.issue.deleteMany({ where: { id: issueId } });
    await prisma.systemNotification.deleteMany({
      where: {
        OR: [
          { dedupeKey: { startsWith: prefix } },
          ...(approvalId ? [{ sourceId: approvalId }] : []),
          { actorId: { in: users.map(user => user.id) } },
        ],
      },
    });
    await prisma.userAccessGrant.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
