import {
  MajorQualityApprovalStatus,
  Prisma,
} from '@prisma/client';
import { hasCapability, type AccessContext } from '@/lib/department-access';
import { issueCode } from '@/lib/issues';
import { prisma } from '@/lib/prisma';
import {
  createSystemNotification,
  eligibleUserIdsForCapability,
  issueParticipantUserIds,
} from '@/lib/system-notifications';

export const MAJOR_QUALITY_APPROVAL_STATUSES = Object.values(MajorQualityApprovalStatus);
export type MajorQualityDecision = 'APPROVE' | 'RETURN';

export class MajorQualityApprovalError extends Error {
  constructor(
    message: string,
    public status = 409,
    public code = 'MAJOR_QUALITY_APPROVAL_INVALID',
  ) {
    super(message);
  }
}

const personSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  username: true,
  displayName: true,
});

export const majorQualityApprovalInclude = Prisma.validator<Prisma.IssueMajorApprovalInclude>()({
  submittedBy: { select: personSelect },
  qualityReviewedBy: { select: personSelect },
  finalReviewedBy: { select: personSelect },
  issue: {
    select: {
      id: true,
      sequence: true,
      title: true,
      type: true,
      priority: true,
      status: true,
      description: true,
      solution: true,
      verificationResult: true,
      isMajorQuality: true,
      majorQualityReason: true,
      version: true,
      createdAt: true,
      deletedAt: true,
      reporter: { select: personSelect },
      assigneeEmployee: { select: { name: true } },
      workOrder: { select: { code: true, specification: true } },
    },
  },
  events: {
    orderBy: { createdAt: 'asc' },
  },
});

type MajorApprovalRecord = Prisma.IssueMajorApprovalGetPayload<{
  include: typeof majorQualityApprovalInclude;
}>;

type ApprovalActor = {
  id: string;
  username: string;
  displayName: string;
  access: AccessContext;
};

type SubmitIssue = {
  id: string;
  sequence: number;
  title: string;
  type: string;
  status: string;
  isMajorQuality: boolean;
  majorQualityReason: string | null;
  version: number;
  deletedAt: Date | null;
};

type MajorQualityIssueSnapshot = {
  schemaVersion: 1;
  issueId: string;
  issueVersion: number;
  code: string;
  title: string;
  type: string;
  priority: string;
  description: string | null;
  rootCause: string | null;
  solution: string | null;
  verificationResult: string | null;
  majorQualityReason: string;
  workOrderCode: string | null;
  reporterName: string | null;
  assigneeName: string | null;
  createdAt: string;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    fileType: string;
    size: string;
  }>;
};

function issueSnapshot(value: Prisma.JsonValue): MajorQualityIssueSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<MajorQualityIssueSnapshot>;
  if (candidate.schemaVersion !== 1 || typeof candidate.issueId !== 'string' || typeof candidate.title !== 'string') {
    return null;
  }
  return candidate as MajorQualityIssueSnapshot;
}

function actorName(actor: Pick<ApprovalActor, 'displayName' | 'username'>): string {
  return String(actor.displayName || actor.username).trim().slice(0, 120) || '未知人员';
}

function decisionNote(value: unknown): string {
  const note = typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  if (!note) throw new MajorQualityApprovalError('请填写复核或审批结论', 400, 'MAJOR_QUALITY_NOTE_REQUIRED');
  return note;
}

export function parseMajorQualityDecision(value: unknown): MajorQualityDecision {
  if (value === 'APPROVE' || value === 'RETURN') return value;
  throw new MajorQualityApprovalError('审批决定不正确', 400, 'MAJOR_QUALITY_DECISION_INVALID');
}

function distinctReviewPairExists(qualityUserIds: readonly string[], gmUserIds: readonly string[]): boolean {
  return qualityUserIds.some(qualityId => gmUserIds.some(gmId => gmId !== qualityId));
}

export function majorApprovalViewer(access: AccessContext) {
  return {
    canQualityReview: hasCapability(access, 'QUALITY', 'EXECUTE_WORKFLOW'),
    canFinalApprove: hasCapability(access, 'MAJOR_APPROVAL', 'APPROVE'),
  };
}

function serializePerson(person: { displayName: string; username: string } | null): string | null {
  return person?.displayName || person?.username || null;
}

export function serializeMajorQualityApproval(approval: MajorApprovalRecord) {
  const snapshot = issueSnapshot(approval.issueSnapshot);
  return {
    id: approval.id,
    round: approval.round,
    status: approval.status,
    version: approval.version,
    issueVersion: approval.issueVersion,
    issue: {
      id: approval.issue.id,
      code: snapshot?.code || issueCode(approval.issue.sequence),
      title: snapshot?.title || approval.issue.title,
      priority: snapshot?.priority || approval.issue.priority,
      status: approval.issue.status,
      sourceDeleted: !!approval.issue.deletedAt,
      snapshotVersion: approval.issueVersion,
      majorQualityReason: snapshot ? snapshot.majorQualityReason : approval.issue.majorQualityReason,
      description: snapshot ? snapshot.description : approval.issue.description,
      rootCause: snapshot ? snapshot.rootCause : null,
      solution: snapshot ? snapshot.solution : approval.issue.solution,
      verificationResult: snapshot ? snapshot.verificationResult : approval.issue.verificationResult,
      workOrderCode: snapshot
        ? snapshot.workOrderCode
        : approval.issue.workOrder?.specification || approval.issue.workOrder?.code || null,
      reporterName: snapshot ? snapshot.reporterName : serializePerson(approval.issue.reporter),
      assigneeName: snapshot ? snapshot.assigneeName : approval.issue.assigneeEmployee?.name || null,
      createdAt: snapshot?.createdAt || approval.issue.createdAt.toISOString(),
      attachments: snapshot?.attachments || [],
    },
    submittedByName: serializePerson(approval.submittedBy),
    submittedAt: approval.submittedAt.toISOString(),
    qualityReviewedByName: serializePerson(approval.qualityReviewedBy),
    qualityReviewedAt: approval.qualityReviewedAt?.toISOString() || null,
    qualityReviewNote: approval.qualityReviewNote,
    finalReviewedByName: serializePerson(approval.finalReviewedBy),
    finalReviewedAt: approval.finalReviewedAt?.toISOString() || null,
    finalReviewNote: approval.finalReviewNote,
    completedAt: approval.completedAt?.toISOString() || null,
    events: approval.events.map(event => ({
      id: event.id,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function loadMajorQualityApprovals(
  actor: ApprovalActor,
  status?: MajorQualityApprovalStatus | null,
) {
  const viewer = majorApprovalViewer(actor.access);
  if (!viewer.canQualityReview && !viewer.canFinalApprove) {
    throw new MajorQualityApprovalError('当前账号没有重大质量审批查看权限', 403, 'MAJOR_QUALITY_FORBIDDEN');
  }
  const where: Prisma.IssueMajorApprovalWhereInput = {
    ...(status ? { status } : {}),
  };
  const [records, grouped] = await Promise.all([
    prisma.issueMajorApproval.findMany({
      where,
      include: majorQualityApprovalInclude,
      orderBy: [{ updatedAt: 'desc' }, { round: 'desc' }],
      take: 300,
    }),
    prisma.issueMajorApproval.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);
  const counts = Object.fromEntries(MAJOR_QUALITY_APPROVAL_STATUSES.map(item => [item, 0])) as Record<MajorQualityApprovalStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;
  return { approvals: records.map(serializeMajorQualityApproval), counts, viewer };
}

export async function submitMajorQualityApproval(
  tx: Prisma.TransactionClient,
  issue: SubmitIssue,
  actor: ApprovalActor,
  nextIssueVersion: number,
): Promise<string> {
  if (issue.deletedAt) throw new MajorQualityApprovalError('问题已删除，不能提交重大审批', 404);
  if (issue.type !== 'quality' || !issue.isMajorQuality || !issue.majorQualityReason?.trim()) {
    throw new MajorQualityApprovalError('该问题不是资料完整的重大质量事项', 409);
  }
  if (issue.status !== 'processing') throw new MajorQualityApprovalError('只有处理中的重大质量问题可以提交复核', 409);

  const snapshotSource = await tx.issue.findUnique({
    where: { id: issue.id },
    select: {
      id: true,
      sequence: true,
      title: true,
      type: true,
      priority: true,
      status: true,
      description: true,
      rootCause: true,
      solution: true,
      verificationResult: true,
      majorQualityReason: true,
      version: true,
      createdAt: true,
      deletedAt: true,
      reporter: { select: personSelect },
      assigneeEmployee: { select: { name: true } },
      workOrder: { select: { code: true, specification: true } },
      attachments: {
        where: { deletedAt: null },
        select: { id: true, originalName: true, mimeType: true, fileType: true, size: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (
    !snapshotSource
    || snapshotSource.deletedAt
    || snapshotSource.status !== 'verifying'
    || snapshotSource.version !== nextIssueVersion
  ) {
    throw new MajorQualityApprovalError('问题内容或状态已变化，请刷新后重新提交', 409, 'MAJOR_QUALITY_ISSUE_CHANGED');
  }
  const snapshot: MajorQualityIssueSnapshot = {
    schemaVersion: 1,
    issueId: snapshotSource.id,
    issueVersion: snapshotSource.version,
    code: issueCode(snapshotSource.sequence),
    title: snapshotSource.title,
    type: snapshotSource.type,
    priority: snapshotSource.priority,
    description: snapshotSource.description,
    rootCause: snapshotSource.rootCause,
    solution: snapshotSource.solution,
    verificationResult: snapshotSource.verificationResult,
    majorQualityReason: snapshotSource.majorQualityReason || '',
    workOrderCode: snapshotSource.workOrder?.specification || snapshotSource.workOrder?.code || null,
    reporterName: serializePerson(snapshotSource.reporter),
    assigneeName: snapshotSource.assigneeEmployee?.name || null,
    createdAt: snapshotSource.createdAt.toISOString(),
    attachments: snapshotSource.attachments.map(attachment => ({
      id: attachment.id,
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      fileType: attachment.fileType,
      size: attachment.size.toString(),
    })),
  };

  const [qualityUserIds, gmUserIds] = await Promise.all([
    eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW', { excludeUserIds: [actor.id] }),
    eligibleUserIdsForCapability(tx, 'MAJOR_APPROVAL', 'APPROVE', { excludeUserIds: [actor.id] }),
  ]);
  if (!qualityUserIds.length) {
    throw new MajorQualityApprovalError('没有可执行二次复核的其他质量账号，请先由管理员配置', 409, 'MAJOR_QUALITY_REVIEWER_MISSING');
  }
  if (!gmUserIds.length || !distinctReviewPairExists(qualityUserIds, gmUserIds)) {
    throw new MajorQualityApprovalError('没有与提交人、质量复核人相互独立的终审账号，请先由管理员配置', 409, 'MAJOR_QUALITY_APPROVER_MISSING');
  }
  const latest = await tx.issueMajorApproval.findFirst({
    where: { issueId: issue.id },
    orderBy: { round: 'desc' },
    select: { round: true },
  });
  const round = (latest?.round || 0) + 1;
  const approval = await tx.issueMajorApproval.create({
    data: {
      issueId: issue.id,
      round,
      issueVersion: nextIssueVersion,
      issueSnapshot: snapshot,
      submittedById: actor.id,
      events: {
        create: {
          action: 'SUBMIT',
          toStatus: 'PENDING_QUALITY_REVIEW',
          note: issue.majorQualityReason,
          actorId: actor.id,
          actorName: actorName(actor),
        },
      },
    },
    select: { id: true },
  });
  await createSystemNotification(tx, {
    eventType: 'MAJOR_QUALITY_REVIEW_REQUESTED',
    dedupeKey: `major-quality:${issue.id}:round:${round}:quality-review`,
    category: 'APPROVAL',
    priority: 'URGENT',
    title: `重大质量问题 ${issueCode(issue.sequence)} 待二次复核`,
    body: issue.title,
    targetRoute: `/workspace/approvals?approvalId=${encodeURIComponent(approval.id)}`,
    sourceType: 'issue_major_approval',
    sourceId: approval.id,
    actorId: actor.id,
    metadata: { issueId: issue.id, round },
    recipientUserIds: qualityUserIds,
  });
  return approval.id;
}

type DecisionInput = {
  issueId: string;
  approvalId: string;
  expectedVersion: number;
  decision: MajorQualityDecision;
  note: string;
};

async function decisionRecipients(
  tx: Prisma.TransactionClient,
  approval: Pick<MajorApprovalRecord, 'issueId' | 'submittedById' | 'qualityReviewedById'>,
  excludeUserIds: readonly string[],
): Promise<string[]> {
  const participants = await issueParticipantUserIds(tx, approval.issueId, { excludeUserIds });
  return [...new Set([
    ...participants,
    ...(approval.submittedById && !excludeUserIds.includes(approval.submittedById) ? [approval.submittedById] : []),
    ...(approval.qualityReviewedById && !excludeUserIds.includes(approval.qualityReviewedById) ? [approval.qualityReviewedById] : []),
  ])];
}

export async function reviewMajorQualityApproval(
  actor: ApprovalActor,
  rawInput: DecisionInput,
) {
  if (!hasCapability(actor.access, 'QUALITY', 'EXECUTE_WORKFLOW')) {
    throw new MajorQualityApprovalError('当前账号没有质量复核权限', 403, 'MAJOR_QUALITY_REVIEW_FORBIDDEN');
  }
  const decision = parseMajorQualityDecision(rawInput.decision);
  const note = decisionNote(rawInput.note);
  return prisma.$transaction(async tx => {
    const approval = await tx.issueMajorApproval.findUnique({
      where: { id: rawInput.approvalId },
      include: majorQualityApprovalInclude,
    });
    if (!approval || approval.issue.deletedAt) throw new MajorQualityApprovalError('审批记录不存在', 404);
    if (approval.issueId !== rawInput.issueId) throw new MajorQualityApprovalError('审批记录不存在', 404);
    if (approval.status !== 'PENDING_QUALITY_REVIEW' || approval.version !== rawInput.expectedVersion) {
      throw new MajorQualityApprovalError('审批状态已变化，请刷新后重试', 409, 'MAJOR_QUALITY_VERSION_CONFLICT');
    }
    if (approval.submittedById === actor.id) {
      throw new MajorQualityApprovalError('提交人不能复核自己的重大质量事项', 409, 'MAJOR_QUALITY_SELF_REVIEW');
    }
    if (approval.issue.status !== 'verifying' || approval.issue.version !== approval.issueVersion) {
      throw new MajorQualityApprovalError('问题内容或状态已变化，请退回后重新提交审批', 409, 'MAJOR_QUALITY_ISSUE_CHANGED');
    }
    const now = new Date();
    const nextStatus: MajorQualityApprovalStatus = decision === 'APPROVE'
      ? 'PENDING_GM_APPROVAL'
      : 'QUALITY_RETURNED';
    let gmUserIds: string[] = [];
    if (decision === 'APPROVE') {
      gmUserIds = await eligibleUserIdsForCapability(tx, 'MAJOR_APPROVAL', 'APPROVE', {
        excludeUserIds: [actor.id, approval.submittedById || ''],
      });
      if (!gmUserIds.length) {
        throw new MajorQualityApprovalError('没有与提交人和复核人相互独立的终审账号', 409, 'MAJOR_QUALITY_APPROVER_MISSING');
      }
    }
    const changed = await tx.issueMajorApproval.updateMany({
      where: { id: approval.id, status: approval.status, version: approval.version },
      data: {
        status: nextStatus,
        version: { increment: 1 },
        qualityReviewedById: actor.id,
        qualityReviewedAt: now,
        qualityReviewNote: note,
        completedAt: decision === 'RETURN' ? now : null,
      },
    });
    if (changed.count !== 1) throw new MajorQualityApprovalError('审批已被其他人处理，请刷新后重试', 409, 'MAJOR_QUALITY_VERSION_CONFLICT');
    await tx.issueMajorApprovalEvent.create({
      data: {
        approvalId: approval.id,
        action: decision === 'APPROVE' ? 'QUALITY_APPROVE' : 'QUALITY_RETURN',
        fromStatus: approval.status,
        toStatus: nextStatus,
        note,
        actorId: actor.id,
        actorName: actorName(actor),
      },
    });
    if (decision === 'APPROVE') {
      await tx.issueActivity.create({
        data: { issueId: approval.issueId, action: 'major_quality_review', content: note, actorId: actor.id },
      });
      await createSystemNotification(tx, {
        eventType: 'MAJOR_QUALITY_FINAL_APPROVAL_REQUESTED',
        dedupeKey: `major-quality:${approval.issueId}:round:${approval.round}:gm-approval`,
        category: 'APPROVAL',
        priority: 'URGENT',
        title: `重大质量问题 ${issueCode(approval.issue.sequence)} 待总经办终审`,
        body: approval.issue.title,
        targetRoute: `/workspace/approvals?approvalId=${encodeURIComponent(approval.id)}`,
        sourceType: 'issue_major_approval',
        sourceId: approval.id,
        actorId: actor.id,
        metadata: { issueId: approval.issueId, round: approval.round },
        recipientUserIds: gmUserIds,
      });
    } else {
      const issueChanged = await tx.issue.updateMany({
        where: { id: approval.issueId, status: 'verifying', version: approval.issueVersion, deletedAt: null },
        data: { status: 'processing', resolvedAt: null, verifiedAt: null, closedAt: null, version: { increment: 1 } },
      });
      if (issueChanged.count !== 1) throw new MajorQualityApprovalError('问题状态已变化，请刷新后重试', 409);
      await tx.issueActivity.create({
        data: {
          issueId: approval.issueId,
          action: 'major_quality_return',
          content: note,
          fromStatus: 'verifying',
          toStatus: 'processing',
          actorId: actor.id,
        },
      });
      const recipients = await decisionRecipients(tx, approval, [actor.id]);
      await createSystemNotification(tx, {
        eventType: 'MAJOR_QUALITY_REVIEW_RETURNED',
        dedupeKey: `major-quality:${approval.issueId}:round:${approval.round}:quality-return`,
        category: 'APPROVAL',
        priority: 'HIGH',
        title: `重大质量问题 ${issueCode(approval.issue.sequence)} 已退回整改`,
        body: note,
        targetRoute: '/workspace/issues',
        sourceType: 'issue_major_approval',
        sourceId: approval.id,
        actorId: actor.id,
        metadata: { issueId: approval.issueId, round: approval.round },
        recipientUserIds: recipients,
      });
    }
    return tx.issueMajorApproval.findUniqueOrThrow({
      where: { id: approval.id },
      include: majorQualityApprovalInclude,
    });
  }).then(serializeMajorQualityApproval);
}

export async function decideMajorQualityApproval(
  actor: ApprovalActor,
  rawInput: DecisionInput,
) {
  if (!hasCapability(actor.access, 'MAJOR_APPROVAL', 'APPROVE')) {
    throw new MajorQualityApprovalError('当前账号没有重大事项终审权限', 403, 'MAJOR_QUALITY_FINAL_FORBIDDEN');
  }
  const decision = parseMajorQualityDecision(rawInput.decision);
  const note = decisionNote(rawInput.note);
  return prisma.$transaction(async tx => {
    const approval = await tx.issueMajorApproval.findUnique({
      where: { id: rawInput.approvalId },
      include: majorQualityApprovalInclude,
    });
    if (!approval || approval.issue.deletedAt) throw new MajorQualityApprovalError('审批记录不存在', 404);
    if (approval.issueId !== rawInput.issueId) throw new MajorQualityApprovalError('审批记录不存在', 404);
    if (approval.status !== 'PENDING_GM_APPROVAL' || approval.version !== rawInput.expectedVersion) {
      throw new MajorQualityApprovalError('审批状态已变化，请刷新后重试', 409, 'MAJOR_QUALITY_VERSION_CONFLICT');
    }
    if (approval.submittedById === actor.id || approval.qualityReviewedById === actor.id) {
      throw new MajorQualityApprovalError('终审人必须与提交人、质量复核人相互独立', 409, 'MAJOR_QUALITY_SELF_APPROVAL');
    }
    if (approval.issue.status !== 'verifying' || approval.issue.version !== approval.issueVersion) {
      throw new MajorQualityApprovalError('问题内容或状态已变化，请退回后重新提交审批', 409, 'MAJOR_QUALITY_ISSUE_CHANGED');
    }
    const now = new Date();
    const nextStatus: MajorQualityApprovalStatus = decision === 'APPROVE' ? 'APPROVED' : 'GM_RETURNED';
    const changed = await tx.issueMajorApproval.updateMany({
      where: { id: approval.id, status: approval.status, version: approval.version },
      data: {
        status: nextStatus,
        version: { increment: 1 },
        finalReviewedById: actor.id,
        finalReviewedAt: now,
        finalReviewNote: note,
        completedAt: now,
      },
    });
    if (changed.count !== 1) throw new MajorQualityApprovalError('审批已被其他人处理，请刷新后重试', 409, 'MAJOR_QUALITY_VERSION_CONFLICT');
    const issueStatus = decision === 'APPROVE' ? 'closed' : 'processing';
    const issueChanged = await tx.issue.updateMany({
      where: { id: approval.issueId, status: 'verifying', version: approval.issueVersion, deletedAt: null },
      data: decision === 'APPROVE'
        ? { status: issueStatus, verifiedAt: now, closedAt: now, version: { increment: 1 } }
        : { status: issueStatus, resolvedAt: null, verifiedAt: null, closedAt: null, version: { increment: 1 } },
    });
    if (issueChanged.count !== 1) throw new MajorQualityApprovalError('问题状态已变化，请刷新后重试', 409);
    await tx.issueMajorApprovalEvent.create({
      data: {
        approvalId: approval.id,
        action: decision === 'APPROVE' ? 'FINAL_APPROVE' : 'FINAL_RETURN',
        fromStatus: approval.status,
        toStatus: nextStatus,
        note,
        actorId: actor.id,
        actorName: actorName(actor),
      },
    });
    await tx.issueActivity.create({
      data: {
        issueId: approval.issueId,
        action: decision === 'APPROVE' ? 'major_quality_approved' : 'major_quality_return',
        content: note,
        fromStatus: 'verifying',
        toStatus: issueStatus,
        actorId: actor.id,
      },
    });
    const recipients = await decisionRecipients(tx, approval, [actor.id]);
    await createSystemNotification(tx, {
      eventType: decision === 'APPROVE' ? 'MAJOR_QUALITY_APPROVED' : 'MAJOR_QUALITY_FINAL_RETURNED',
      dedupeKey: `major-quality:${approval.issueId}:round:${approval.round}:final:${decision.toLowerCase()}`,
      category: 'APPROVAL',
      priority: decision === 'APPROVE' ? 'HIGH' : 'URGENT',
      title: decision === 'APPROVE'
        ? `重大质量问题 ${issueCode(approval.issue.sequence)} 已终审通过并关闭`
        : `重大质量问题 ${issueCode(approval.issue.sequence)} 已由总经办退回`,
      body: note,
      targetRoute: '/workspace/issues',
      sourceType: 'issue_major_approval',
      sourceId: approval.id,
      actorId: actor.id,
      metadata: { issueId: approval.issueId, round: approval.round },
      recipientUserIds: recipients,
    });
    return tx.issueMajorApproval.findUniqueOrThrow({
      where: { id: approval.id },
      include: majorQualityApprovalInclude,
    });
  }).then(serializeMajorQualityApproval);
}

export async function cancelPendingMajorQualityApproval(
  tx: Prisma.TransactionClient,
  issueId: string,
  actor: ApprovalActor,
  reason: string,
): Promise<void> {
  const approval = await tx.issueMajorApproval.findFirst({
    where: {
      issueId,
      status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'] },
    },
    orderBy: { round: 'desc' },
  });
  if (!approval) return;
  const note = decisionNote(reason);
  const changed = await tx.issueMajorApproval.updateMany({
    where: { id: approval.id, status: approval.status, version: approval.version },
    data: { status: 'CANCELLED', completedAt: new Date(), version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new MajorQualityApprovalError('审批状态已变化，请刷新后重试', 409);
  await tx.issueMajorApprovalEvent.create({
    data: {
      approvalId: approval.id,
      action: 'CANCEL',
      fromStatus: approval.status,
      toStatus: 'CANCELLED',
      note,
      actorId: actor.id,
      actorName: actorName(actor),
    },
  });
  const recipients = await decisionRecipients(tx, approval, [actor.id]);
  await createSystemNotification(tx, {
    eventType: 'MAJOR_QUALITY_APPROVAL_CANCELLED',
    dedupeKey: `major-quality:${approval.issueId}:round:${approval.round}:cancelled`,
    category: 'APPROVAL',
    priority: 'HIGH',
    title: '重大质量审批已撤回',
    body: note,
    targetRoute: '/workspace/issues',
    sourceType: 'issue_major_approval',
    sourceId: approval.id,
    actorId: actor.id,
    metadata: { issueId, round: approval.round },
    recipientUserIds: recipients,
  });
}
