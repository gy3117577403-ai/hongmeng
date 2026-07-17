import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_SOURCE_TYPES } from '@/lib/knowledge';
import { searchKnowledge } from '@/lib/knowledge-search';
import type { KnowledgeArticleCategory, KnowledgeSourceType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 160);
    const source = String(req.nextUrl.searchParams.get('source') || 'all') as 'all' | KnowledgeSourceType;
    const category = String(req.nextUrl.searchParams.get('category') || 'all') as 'all' | KnowledgeArticleCategory;
    const limitValue = Number(req.nextUrl.searchParams.get('limit') || 60);
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 60;
    if (source !== 'all' && !KNOWLEDGE_SOURCE_TYPES.includes(source)) return NextResponse.json({ ok: false, error: '知识来源筛选不正确' }, { status: 400 });
    if (category !== 'all' && !KNOWLEDGE_CATEGORIES.includes(category)) return NextResponse.json({ ok: false, error: '知识分类筛选不正确' }, { status: 400 });
    const results = await searchKnowledge({ keyword, source, category, limit });
    return NextResponse.json({ ok: true, keyword, source, category, results, total: results.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge search failed', error);
    return NextResponse.json({ ok: false, error: '知识检索失败' }, { status: 500 });
  }
}
