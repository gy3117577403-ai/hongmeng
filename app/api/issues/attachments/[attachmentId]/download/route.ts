import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    const user = await requireUser();
    const attachment = await prisma.issueAttachment.findFirst({
      where: { id: params.attachmentId, deletedAt: null, issue: { deletedAt: null } },
    });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    await logOp({ userId: user.id, action: 'download_issue_attachment', targetType: 'issue_attachment', targetId: attachment.id, detail: { issueId: attachment.issueId } });
    return NextResponse.redirect(await signedUrl({
      key: attachment.objectKey,
      filename: attachment.displayName?.trim() || attachment.originalName,
      disposition: 'attachment',
      contentType: attachment.mimeType,
    }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue attachment download failed', error);
    return NextResponse.json({ ok: false, error: '附件下载失败' }, { status: 500 });
  }
}
