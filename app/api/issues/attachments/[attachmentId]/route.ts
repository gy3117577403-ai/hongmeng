import { NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueAttachmentMutationLock, issueDetailInclude, serializeIssue } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class IssueAttachmentConflictError extends Error {}

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
            status: true,
            version: true,
            majorApprovals: {
              where: { status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED'] } },
              select: { status: true },
            },
          },
        },
      },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    const attachmentLock = issueAttachmentMutationLock(
      attachment.issue.status,
      attachment.issue.majorApprovals.map(approval => approval.status),
    );
    if (attachmentLock === 'approval_pending') {
      return NextResponse.json({ ok: false, error: '重大审批进行中，不能增删审批附件；请先退回处理' }, { status: 409 });
    }
    if (attachmentLock === 'final_approved') {
      return NextResponse.json({ ok: false, error: '重大问题已终审关闭，请先重新打开再修改附件' }, { status: 409 });
    }
    const issue = await prisma.$transaction(async tx => {
      const issueUpdated = await tx.issue.updateMany({
        where: {
          id: attachment.issueId,
          status: attachment.issue.status,
          version: attachment.issue.version,
          deletedAt: null,
          majorApprovals: {
            none: { status: { in: ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'] } },
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
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAttachmentConflictError) {
      return NextResponse.json({ ok: false, error: '问题或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    console.error('issue attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '附件删除失败' }, { status: 500 });
  }
}
