import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { knowledgeArticleInclude, serializeKnowledgeArticle } from '@/lib/knowledge';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    const user = await requireUser();
    const attachment = await prisma.knowledgeAttachment.findFirst({ where: { id: params.attachmentId, deletedAt: null, article: { deletedAt: null } } });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    const article = await prisma.$transaction(async tx => {
      await tx.knowledgeAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      await tx.knowledgeArticle.update({ where: { id: attachment.articleId }, data: { updatedById: user.id, version: { increment: 1 } } });
      return tx.knowledgeArticle.findUniqueOrThrow({ where: { id: attachment.articleId }, include: knowledgeArticleInclude });
    });
    await logOp({ userId: user.id, action: 'delete_knowledge_attachment', targetType: 'knowledge_attachment', targetId: attachment.id, detail: { articleId: attachment.articleId } });
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(article) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '知识附件删除失败' }, { status: 500 });
  }
}
