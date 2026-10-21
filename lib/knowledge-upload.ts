import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeKnowledgeArticle } from '@/lib/knowledge';
import { knowledgeFileInfo, validateKnowledgeFile } from '@/lib/knowledge-file-validation';
import { KnowledgeWriteError, lockKnowledgeArticle } from '@/lib/knowledge-write';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { maxBytes, safeFilename } from '@/lib/validation';

export async function uploadKnowledgeAttachment(req: NextRequest, articleId?: string) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) throw new KnowledgeWriteError('请选择附件');
    if (upload.size > maxBytes()) throw new KnowledgeWriteError(`单文件不能超过 ${maxBytes() / 1024 / 1024} MB`);
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateKnowledgeFile(upload.name, upload.type, upload.size, body);
    if (validationError) throw new KnowledgeWriteError(validationError);
    const info = knowledgeFileInfo(upload.name, upload.type);
    const objectKey = `knowledge/${articleId || 'staged'}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    await putObject({ key: objectKey, body, contentType: info.mimeType, originalName: upload.name });
    let result;
    try {
      result = await prisma.$transaction(async tx => {
        if (articleId) await lockKnowledgeArticle(tx, articleId);
        const attachment = await tx.knowledgeAttachment.create({ data: {
          articleId, objectKey, originalName: upload.name.slice(0, 240), ...info,
          size: BigInt(upload.size), uploadedById: user.id,
        } });
        if (articleId) await tx.knowledgeArticle.update({ where: { id: articleId }, data: { updatedById: user.id, version: { increment: 1 } } });
        return { attachment, article: articleId ? await lockKnowledgeArticle(tx, articleId) : null };
      });
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      throw error;
    }
    await logOp({ userId: user.id, action: 'upload_knowledge_attachment', targetType: 'knowledge_attachment', targetId: result.attachment.id, detail: { articleId, ...info, size: upload.size } });
    return NextResponse.json({ ok: true, attachment: { id: result.attachment.id, originalName: result.attachment.originalName, ...info, size: upload.size }, article: result.article ? serializeKnowledgeArticle(result.article) : undefined });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof KnowledgeWriteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('knowledge attachment upload failed', error);
    return NextResponse.json({ ok: false, error: '知识附件上传失败，请重试' }, { status: 500 });
  }
}
