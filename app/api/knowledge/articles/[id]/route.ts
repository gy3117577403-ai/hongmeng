import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { snapshotChange } from '@/lib/change-snapshots';
import {
  knowledgeArticleInclude,
  knowledgeArticleSnapshot,
  serializeKnowledgeArticle,
} from '@/lib/knowledge';
import { saveKnowledgeArticle, lockKnowledgeArticle, KnowledgeWriteError } from '@/lib/knowledge-write';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const article = await prisma.knowledgeArticle.findFirst({ where: { id: params.id, deletedAt: null }, include: knowledgeArticleInclude });
    if (!article) return NextResponse.json({ ok: false, error: '知识文章不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(article) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge article detail failed', error);
    return NextResponse.json({ ok: false, error: '知识文章详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { before: current, article } = await saveKnowledgeArticle(body, user.id, params.id);
    const changedFields = Object.keys(body);
    await Promise.all([
      snapshotChange({ entityType: 'knowledge_article', entityId: article.id, action: 'update', before: knowledgeArticleSnapshot(current!), after: knowledgeArticleSnapshot(article), changedBy: user.id }),
      logOp({ userId: user.id, action: 'update_knowledge_article', targetType: 'knowledge_article', targetId: article.id, detail: { fields: changedFields, version: article.version } }),
    ]);
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(article) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof KnowledgeWriteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('knowledge article update failed', error);
    return NextResponse.json({ ok: false, error: '知识文章更新失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { current, article } = await prisma.$transaction(async tx => {
      const current = await lockKnowledgeArticle(tx, params.id);
      const article = await tx.knowledgeArticle.update({ where: { id: current.id }, data: { deletedAt: new Date(), updatedById: user.id, version: { increment: 1 } } });
      return { current, article };
    });
    await Promise.all([
      snapshotChange({ entityType: 'knowledge_article', entityId: current.id, action: 'delete', before: knowledgeArticleSnapshot(current!), after: knowledgeArticleSnapshot(article), changedBy: user.id }),
      logOp({ userId: user.id, action: 'delete_knowledge_article', targetType: 'knowledge_article', targetId: current.id, detail: { sequence: current.sequence } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof KnowledgeWriteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error('knowledge article delete failed', error);
    return NextResponse.json({ ok: false, error: '知识文章删除失败' }, { status: 500 });
  }
}
