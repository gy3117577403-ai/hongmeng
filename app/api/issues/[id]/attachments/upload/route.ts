import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { issueDetailInclude, serializeIssue } from '@/lib/issues';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFile } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const issue = await prisma.issue.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!issue) return NextResponse.json({ ok: false, error: '问题不存在或已删除' }, { status: 404 });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择附件' }, { status: 400 });
    const validationError = validateFile(upload.name, upload.type, upload.size);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const mimeType = upload.type || 'application/octet-stream';
    const objectKey = `issues/${issue.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body: Buffer.from(await upload.arrayBuffer()), contentType: mimeType, originalName: upload.name });

    const result = await prisma.$transaction(async tx => {
      const attachment = await tx.issueAttachment.create({
        data: {
          issueId: issue.id,
          objectKey,
          originalName: upload.name.slice(0, 240),
          mimeType,
          fileType: fileType(upload.name, mimeType),
          size: BigInt(upload.size),
          uploadedById: user.id,
        },
      });
      await tx.issueActivity.create({ data: { issueId: issue.id, action: 'upload_attachment', content: `上传附件：${upload.name.slice(0, 160)}`, actorId: user.id, detail: { attachmentId: attachment.id } } });
      await tx.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });
      const updatedIssue = await tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: issueDetailInclude });
      return { attachmentId: attachment.id, issue: updatedIssue };
    });
    await logOp({ userId: user.id, action: 'upload_issue_attachment', targetType: 'issue_attachment', targetId: result.attachmentId, detail: { issueId: issue.id, fileType: fileType(upload.name, mimeType), size: upload.size } });
    return NextResponse.json({ ok: true, issue: serializeIssue(result.issue) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '问题附件上传失败' }, { status: 500 });
  }
}
