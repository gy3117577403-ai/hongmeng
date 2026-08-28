import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ISSUE_ATTACHMENT_CATEGORIES,
  issueAttachmentMutationLock,
  issueDetailInclude,
  serializeIssue,
} from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';
import { canMutateIssueForProcess } from '@/lib/process-collaboration-access';
import type { IssueAttachmentCategory, IssueStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class IssueAttachmentConflictError extends Error {}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const issue = await prisma.issue.findFirst({
      where: { id: params.id, deletedAt: null },
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
    });
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    if (user.laborRole !== 'ADMIN' && !canMutateIssueForProcess(user, issue, 'UPDATE')) {
      return NextResponse.json({ ok: false, error: '只能为工艺问题或本人参与的问题上传附件' }, { status: 403 });
    }
    if (issue.status === 'closed') {
      return NextResponse.json({ ok: false, error: '已完结问题为只读归档，请先重新打开后再上传附件' }, { status: 409 });
    }
    const attachmentLock = issueAttachmentMutationLock(
      issue.status,
      issue.majorApprovals.map(approval => approval.status),
    );
    if (attachmentLock === 'approval_pending') {
      return NextResponse.json({ ok: false, error: '重大审批进行中，不能增删审批附件；请先退回处理' }, { status: 409 });
    }
    if (attachmentLock === 'final_approved') {
      return NextResponse.json({ ok: false, error: '重大问题终审通过后内容已锁定；如需整改，请由发起人退回处理' }, { status: 409 });
    }
    const form = await req.formData();
    const rawCategory = String(form.get('category') || 'other');
    const category = ISSUE_ATTACHMENT_CATEGORIES.includes(rawCategory as IssueAttachmentCategory)
      ? rawCategory as IssueAttachmentCategory
      : null;
    if (!category) return NextResponse.json({ ok: false, error: '附件分类不正确' }, { status: 400 });
    const caption = String(form.get('caption') || '').trim().slice(0, 500) || null;
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择附件' }, { status: 400 });
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const mimeType = upload.type || 'application/octet-stream';
    const objectKey = `issues/${issue.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });

    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const updated = await tx.issue.updateMany({
          where: {
            id: issue.id,
            status: issue.status,
            version: issue.version,
            deletedAt: null,
            majorApprovals: {
              none: {
                status: {
                  in: issue.status === 'awaiting_confirmation'
                    ? ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL', 'APPROVED']
                    : ['PENDING_QUALITY_REVIEW', 'PENDING_GM_APPROVAL'],
                },
              },
            },
          },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new IssueAttachmentConflictError();
        const attachment = await tx.issueAttachment.create({
          data: {
            issueId: issue.id,
            objectKey,
            originalName: upload.name.slice(0, 240),
            mimeType,
            fileType: fileType(upload.name, mimeType),
            size: BigInt(upload.size),
            category,
            stage: issue.status as IssueStatus,
            caption,
            uploadedById: user.id,
          },
        });
        await tx.issueActivity.create({
          data: {
            issueId: issue.id,
            action: 'upload_attachment',
            content: `上传附件：${upload.name.slice(0, 160)}`,
            actorId: user.id,
            detail: { attachmentId: attachment.id, category, stage: issue.status, caption },
          },
        });
        const updatedIssue = await tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: issueDetailInclude });
        return { attachmentId: attachment.id, issue: updatedIssue };
      });
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      throw error;
    }
    await logOp({
      userId: user.id,
      action: 'upload_issue_attachment',
      targetType: 'issue_attachment',
      targetId: result.attachmentId,
      detail: { issueId: issue.id, fileType: fileType(upload.name, mimeType), size: upload.size, category, stage: issue.status },
    });
    return NextResponse.json({ ok: true, issue: serializeIssue(result.issue, user) });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    if (error instanceof IssueAttachmentConflictError) {
      return NextResponse.json({ ok: false, error: '问题或审批状态已变化，请刷新后重试' }, { status: 409 });
    }
    console.error('issue attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '问题附件上传失败' }, { status: 500 });
  }
}
