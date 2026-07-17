import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  knowledgeArticleInclude,
  knowledgeArticleSnapshot,
  parseKnowledgeArticleInput,
  serializeKnowledgeArticle,
} from '@/lib/knowledge';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { snapshotChange } from '@/lib/change-snapshots';
import type { KnowledgeArticleCategory, KnowledgeArticleStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const category = String(params.get('category') || 'all');
    const status = String(params.get('status') || 'all');
    const page = integer(params.get('page'), 1, 100000);
    const pageSize = integer(params.get('pageSize'), 40, 100);
    if (category !== 'all' && !KNOWLEDGE_CATEGORIES.includes(category as KnowledgeArticleCategory)) {
      return NextResponse.json({ ok: false, error: '知识分类筛选不正确' }, { status: 400 });
    }
    if (status !== 'all' && !KNOWLEDGE_STATUSES.includes(status as KnowledgeArticleStatus)) {
      return NextResponse.json({ ok: false, error: '知识状态筛选不正确' }, { status: 400 });
    }
    const where: Prisma.KnowledgeArticleWhereInput = { deletedAt: null };
    if (category !== 'all') where.category = category;
    if (status !== 'all') where.status = status;
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { summary: { contains: keyword, mode: 'insensitive' } },
        { content: { contains: keyword, mode: 'insensitive' } },
        { customerName: { contains: keyword, mode: 'insensitive' } },
        { specification: { contains: keyword, mode: 'insensitive' } },
        { productModel: { contains: keyword, mode: 'insensitive' } },
        { tags: { has: keyword } },
      ];
      const sequence = Number(keyword.replace(/^KB-/i, ''));
      if (Number.isInteger(sequence) && sequence > 0) where.OR.push({ sequence });
    }
    const [records, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        include: knowledgeArticleInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.knowledgeArticle.count({ where }),
    ]);
    return NextResponse.json({
      ok: true,
      articles: records.map(serializeKnowledgeArticle),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge article list failed', error);
    return NextResponse.json({ ok: false, error: '知识文章加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.category === undefined) body.category = 'general';
    if (body.status === undefined) body.status = 'published';
    const parsed = parseKnowledgeArticleInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors[0] }, { status: 400 });
    const values = parsed.data;
    const article = await prisma.knowledgeArticle.create({
      data: {
        title: values.title as string,
        category: values.category || 'general',
        status: values.status || 'published',
        summary: values.summary,
        content: values.content as string,
        tags: values.tags || [],
        customerName: values.customerName,
        specification: values.specification,
        productModel: values.productModel,
        createdById: user.id,
        updatedById: user.id,
        relations: values.relations?.length ? { create: values.relations } : undefined,
      },
      include: knowledgeArticleInclude,
    });
    await Promise.all([
      snapshotChange({ entityType: 'knowledge_article', entityId: article.id, action: 'create', after: knowledgeArticleSnapshot(article), changedBy: user.id }),
      logOp({ userId: user.id, action: 'create_knowledge_article', targetType: 'knowledge_article', targetId: article.id, detail: { sequence: article.sequence, category: article.category, status: article.status } }),
    ]);
    return NextResponse.json({ ok: true, article: serializeKnowledgeArticle(article) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge article create failed', error);
    return NextResponse.json({ ok: false, error: '知识文章创建失败' }, { status: 500 });
  }
}
