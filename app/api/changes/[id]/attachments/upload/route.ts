import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { changeDetailInclude, serializeChange } from '@/lib/changes';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const change = await prisma.changeRequest.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!change) return NextResponse.json({ ok: false, error: '变更不存在或已删除' }, { status: 404 });

    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择附件' }, { status: 400 });
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });

    const mimeType = upload.type || 'application/octet-stream';
    const objectKey = `changes/${change.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({
      key: objectKey,
      body,
      contentType: mimeType,
      originalName: upload.name,
    });

    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const attachment = await tx.changeAttachment.create({
          data: {
            changeRequestId: change.id,
            objectKey,
            originalName: upload.name.slice(0, 240),
            mimeType,
            fileType: fileType(upload.name, mimeType),
            size: BigInt(upload.size),
            uploadedById: user.id,
          },
        });
        await tx.changeActivity.create({
          data: {
            changeRequestId: change.id,
            action: 'upload_attachment',
            content: `上传附件：${upload.name.slice(0, 160)}`,
            actorId: user.id,
            detail: { attachmentId: attachment.id },
          },
        });
        await tx.changeRequest.update({ where: { id: change.id }, data: { updatedAt: new Date() } });
        const updatedChange = await tx.changeRequest.findUniqueOrThrow({
          where: { id: change.id },
          include: changeDetailInclude,
        });
        return { attachmentId: attachment.id, change: updatedChange };
      });
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      throw error;
    }

    await logOp({
      userId: user.id,
      action: 'upload_change_attachment',
      targetType: 'change_attachment',
      targetId: result.attachmentId,
      detail: { changeRequestId: change.id, fileType: fileType(upload.name, mimeType), size: upload.size },
    });
    return NextResponse.json({ ok: true, change: serializeChange(result.change) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('change attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '变更附件上传失败' }, { status: 500 });
  }
}
