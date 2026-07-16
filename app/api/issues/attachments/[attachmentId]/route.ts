import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueDetailInclude, serializeIssue } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    const user = await requireUser();
    const attachment = await prisma.issueAttachment.findFirst({
      where: { id: params.attachmentId, deletedAt: null, issue: { deletedAt: null } },
      select: { id: true, issueId: true, originalName: true },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    const issue = await prisma.$transaction(async tx => {
      await tx.issueAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      await tx.issueActivity.create({ data: { issueId: attachment.issueId, action: 'delete_attachment', content: `删除附件：${attachment.originalName.slice(0, 160)}`, actorId: user.id, detail: { attachmentId: attachment.id } } });
      await tx.issue.update({ where: { id: attachment.issueId }, data: { updatedAt: new Date() } });
      return tx.issue.findUniqueOrThrow({ where: { id: attachment.issueId }, include: issueDetailInclude });
    });
    await logOp({ userId: user.id, action: 'delete_issue_attachment', targetType: 'issue_attachment', targetId: attachment.id, detail: { issueId: attachment.issueId } });
    return NextResponse.json({ ok: true, issue: serializeIssue(issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '附件删除失败' }, { status: 500 });
  }
}
