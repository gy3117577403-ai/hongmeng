import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { knowledgeArticleInclude, serializeKnowledgeArticle } from '@/lib/knowledge';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const article = await prisma.knowledgeArticle.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!article) return NextResponse.json({ ok: false, error: '知识文章不存在或已删除' }, { status: 404 });
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择附件' }, { status: 400 });
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const mimeType = upload.type || 'application/octet-stream';
    const objectKey = `knowledge/${article.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });

    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const attachment = await tx.knowledgeAttachment.create({
          data: {
            articleId: article.id,
            objectKey,
            originalName: upload.name.slice(0, 240),
            mimeType,
            fileType: fileType(upload.name, mimeType),
            size: BigInt(upload.size),
            uploadedById: user.id,
          },
        });
        await tx.knowledgeArticle.update({ where: { id: article.id }, data: { updatedById: user.id, version: { increment: 1 } } });
        const updated = await tx.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id }, include: knowledgeArticleInclude });
        return { attachmentId: attachment.id, article: updated };
      });
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      throw error;
    }
    await logOp({ userId: user.id, action: 'upload_knowledge_attachment', targetType: 'knowledge_attachment', targetId: result.attachmentId, detail: { articleId: article.id, fileType: fileType(upload.name, mimeType), size: upload.size } });
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(result.article) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '知识附件上传失败' }, { status: 500 });
  }
}
