import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { snapshotChange } from '@/lib/change-snapshots';
import {
  knowledgeArticleInclude,
  knowledgeArticleSnapshot,
  parseKnowledgeArticleInput,
  serializeKnowledgeArticle,
} from '@/lib/knowledge';
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
    const current = await prisma.knowledgeArticle.findFirst({ where: { id: params.id, deletedAt: null }, include: knowledgeArticleInclude });
    if (!current) return NextResponse.json({ ok: false, error: '知识文章不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.version);
    if (Number.isInteger(expectedVersion) && expectedVersion !== current.version) {
      return NextResponse.json({ ok: false, error: '该知识已被其他人更新，请刷新后重试' }, { status: 409 });
    }
    const parsed = parseKnowledgeArticleInput(body, true);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;
    const data: Prisma.KnowledgeArticleUncheckedUpdateInput = { updatedById: user.id, version: { increment: 1 } };
    if (values.title !== undefined) data.title = values.title;
    if (values.category !== undefined) data.category = values.category;
    if (values.status !== undefined) data.status = values.status;
    if (values.summary !== undefined) data.summary = values.summary;
    if (values.content !== undefined) data.content = values.content;
    if (values.tags !== undefined) data.tags = values.tags;
    if (values.customerName !== undefined) data.customerName = values.customerName;
    if (values.specification !== undefined) data.specification = values.specification;
    if (values.productModel !== undefined) data.productModel = values.productModel;
    const changedFields = Object.keys(values).filter(key => key !== 'relations');
    if (!changedFields.length && values.relations === undefined) return NextResponse.json({ ok: false, error: '没有可更新的字段' }, { status: 400 });

    const article = await prisma.$transaction(async tx => {
      await tx.knowledgeArticle.update({ where: { id: current.id }, data });
      if (values.relations !== undefined) {
        await tx.knowledgeRelation.deleteMany({ where: { articleId: current.id } });
        if (values.relations.length) await tx.knowledgeRelation.createMany({ data: values.relations.map(relation => ({ articleId: current.id, ...relation })) });
      }
      return tx.knowledgeArticle.findUniqueOrThrow({ where: { id: current.id }, include: knowledgeArticleInclude });
    });
    await Promise.all([
      snapshotChange({ entityType: 'knowledge_article', entityId: article.id, action: 'update', before: knowledgeArticleSnapshot(current), after: knowledgeArticleSnapshot(article), changedBy: user.id }),
      logOp({ userId: user.id, action: 'update_knowledge_article', targetType: 'knowledge_article', targetId: article.id, detail: { fields: [...changedFields, ...(values.relations !== undefined ? ['relations'] : [])], version: article.version } }),
    ]);
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(article) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge article update failed', error);
    return NextResponse.json({ ok: false, error: '知识文章更新失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.knowledgeArticle.findFirst({ where: { id: params.id, deletedAt: null }, include: knowledgeArticleInclude });
    if (!current) return NextResponse.json({ ok: false, error: '知识文章不存在或已删除' }, { status: 404 });
    const deletedAt = new Date();
    const article = await prisma.knowledgeArticle.update({ where: { id: current.id }, data: { deletedAt, updatedById: user.id, version: { increment: 1 } } });
    await Promise.all([
      snapshotChange({ entityType: 'knowledge_article', entityId: current.id, action: 'delete', before: knowledgeArticleSnapshot(current), after: knowledgeArticleSnapshot(article), changedBy: user.id }),
      logOp({ userId: user.id, action: 'delete_knowledge_article', targetType: 'knowledge_article', targetId: current.id, detail: { sequence: current.sequence } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge article delete failed', error);
    return NextResponse.json({ ok: false, error: '知识文章删除失败' }, { status: 500 });
  }
}
