import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeKnowledgeArticle } from '@/lib/knowledge';
import { logOp } from '@/lib/logs';
import { removeKnowledgeAttachment, KnowledgeWriteError } from '@/lib/knowledge-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    const user = await requireUser();
    const article = await removeKnowledgeAttachment(params.attachmentId, user.id);
    await logOp({ userId: user.id, action: 'delete_knowledge_attachment', targetType: 'knowledge_attachment', targetId: params.attachmentId, detail: { articleId: article?.id } });
    return NextResponse.json({ ok: true, article: article ? serializeKnowledgeArticle(article) : undefined });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof KnowledgeWriteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('knowledge attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '知识附件删除失败' }, { status: 500 });
  }
}
