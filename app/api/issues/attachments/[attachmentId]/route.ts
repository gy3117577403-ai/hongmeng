import { NextResponse } from 'next/server';
import type { MajorQualityApprovalStatus } from '@prisma/client';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ISSUE_ATTACHMENT_CATEGORIES,
  issueAttachmentCategoryLabels,
  issueAttachmentMutationLock,
  issueDetailInclude,
  serializeIssue,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { canMutateIssueForProcess } from '@/lib/process-collaboration-access';
import type { IssueAttachmentCategory } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class IssueAttachmentConflictError extends Error {}

export async function PATCH(req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const category = typeof body.category === 'string'
      && ISSUE_ATTACHMENT_CATEGORIES.includes(body.category as IssueAttachmentCategory)
      ? body.category as IssueAttachmentCategory
      : null;
    const expectedVersion = Number(body.version);
    const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 500) || null : null;
    if (!category) return NextResponse.json({ ok: false, error: '附件分类不正确' }, { status: 400 });
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '附件版本不正确，请刷新后重试' }, { status: 400 });
    }
    const attachment = await prisma.issueAttachment.findFirst({
      where: { id: params.attachmentId, deletedAt: null, issue: { deletedAt: null } },
      select: {
        id: true,
        issueId: true,
        originalName: true,
        category: true,
        caption: true,
        version: true,
        issue: {
          select: {
            id: true,
            type: true,
            isMajorQuality: true,
            reporterId: true,
            assigneeEmployeeId: true,
            status: true,
            version: true,
            collaborators: { select: { employeeId: true } },
            majorApprovals: {
              where: { status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED'] } },
              select: { status: true },
            },
          },
        },
      },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    if (user.laborRole !== 'ADMIN' && !canMutateIssueForProcess(user, attachment.issue, 'UPDATE')) {
      return NextResponse.json({ ok: false, error: '只能整理工艺问题或本人参与问题的附件' }, { status: 403 });
    }
    if (attachment.issue.status === 'closed') {
      return NextResponse.json({ ok: false, error: '已完结问题为只读归档，请先重新打开后再调整文件分类' }, { status: 409 });
    }
    const attachmentLock = issueAttachmentMutationLock(
      attachment.issue.status,
      attachment.issue.majorApprovals.map(approval => approval.status),
    );
    if (attachmentLock === 'approval_pending') {
      return NextResponse.json({ ok: false, error: '重大审批进行中，不能调整文件分类；请先退回处理' }, { status: 409 });
    }
    if (attachmentLock === 'final_approved') {
      return NextResponse.json({ ok: false, error: '重大问题终审通过后内容已锁定；如需整改，请由发起人退回处理' }, { status: 409 });
    }
    const blockedApprovalStatuses: MajorQualityApprovalStatus[] = attachment.issue.status === 'awaiting_confirmation'
      ? ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED']
      : ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'];
    const issue = await prisma.$transaction(async tx => {
      const issueUpdated = await tx.issue.updateMany({
        where: {
          id: attachment.issueId,
          status: attachment.issue.status,
          version: attachment.issue.version,
          deletedAt: null,
          majorApprovals: { none: { status: { in: blockedApprovalStatuses } } },
        },
        data: { version: { increment: 1 } },
      });
      if (issueUpdated.count !== 1) throw new IssueAttachmentConflictError();
      const attachmentUpdated = await tx.issueAttachment.updateMany({
        where: { id: attachment.id, version: expectedVersion, deletedAt: null },
        data: { category, caption, version: { increment: 1 } },
      });
      if (attachmentUpdated.count !== 1) throw new IssueAttachmentConflictError();
      await tx.issueActivity.create({
        data: {
          issueId: attachment.issueId,
          action: 'classify_attachment',
          content: `附件归档分类：${attachment.originalName.slice(0, 120)} → ${issueAttachmentCategoryLabels[category]}`,
          actorId: user.id,
          detail: {
            attachmentId: attachment.id,
            fromCategory: attachment.category,
            toCategory: category,
          },
        },
      });
      return tx.issue.findUniqueOrThrow({ where: { id: attachment.issueId }, include: issueDetailInclude });
    });
    await logOp({
      userId: user.id,
      action: 'classify_issue_attachment',
      targetType: 'issue_attachment',
      targetId: attachment.id,
      detail: { issueId: attachment.issueId, fromCategory: attachment.category, toCategory: category },
    });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue, user) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAttachmentConflictError) {
      return NextResponse.json({ ok: false, error: '问题、附件或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    console.error('issue attachment classification failed', error);
    return NextResponse.json({ ok: false, error: '附件分类更新失败' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const attachment = await prisma.issueAttachment.findFirst({
      where: { id: params.attachmentId, deletedAt: null, issue: { deletedAt: null } },
      select: {
        id: true,
        issueId: true,
        originalName: true,
        issue: {
          select: {
            id: true,
            type: true,
            isMajorQuality: true,
            reporterId: true,
            assigneeEmployeeId: true,
            status: true,
            version: true,
            collaborators: { select: { employeeId: true } },
            majorApprovals: {
              where: { status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED'] } },
              select: { status: true },
            },
          },
        },
      },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    if (user.laborRole !== 'ADMIN' && !canMutateIssueForProcess(user, attachment.issue, 'UPDATE')) {
      return NextResponse.json({ ok: false, error: '只能删除工艺问题或本人参与问题的附件' }, { status: 403 });
    }
    if (attachment.issue.status === 'closed') {
      return NextResponse.json({ ok: false, error: '已完结问题为只读归档，请先重新打开后再删除附件' }, { status: 409 });
    }
    const attachmentLock = issueAttachmentMutationLock(
      attachment.issue.status,
      attachment.issue.majorApprovals.map(approval => approval.status),
    );
    if (attachmentLock === 'approval_pending') {
      return NextResponse.json({ ok: false, error: '重大审批进行中，不能增删审批附件；请先退回处理' }, { status: 409 });
    }
    if (attachmentLock === 'final_approved') {
      return NextResponse.json({ ok: false, error: '重大问题终审通过后内容已锁定；如需整改，请由发起人退回处理' }, { status: 409 });
    }
    const issue = await prisma.$transaction(async tx => {
      const issueUpdated = await tx.issue.updateMany({
        where: {
          id: attachment.issueId,
          status: attachment.issue.status,
          version: attachment.issue.version,
          deletedAt: null,
          majorApprovals: {
            none: {
              status: {
                in: attachment.issue.status === 'awaiting_confirmation'
                  ? ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED']
                  : ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'],
              },
            },
          },
        },
        data: { version: { increment: 1 } },
      });
      if (issueUpdated.count !== 1) throw new IssueAttachmentConflictError();
      const attachmentUpdated = await tx.issueAttachment.updateMany({
        where: { id: attachment.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (attachmentUpdated.count !== 1) throw new IssueAttachmentConflictError();
      await tx.issueActivity.create({ data: { issueId: attachment.issueId, action: 'delete_attachment', content: `删除附件：${attachment.originalName.slice(0, 160)}`, actorId: user.id, detail: { attachmentId: attachment.id } } });
      return tx.issue.findUniqueOrThrow({ where: { id: attachment.issueId }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: 'delete_issue_attachment', targetType: 'issue_attachment', targetId: attachment.id, detail: { issueId: attachment.issueId } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue, user) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAttachmentConflictError) {
      return NextResponse.json({ ok: false, error: '问题或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    console.error('issue attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '附件删除失败' }, { status: 500 });
  }
}
