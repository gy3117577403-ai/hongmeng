import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { KnowledgeOverviewDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [articleCount, drawingCount, manualCount, parameterCount, processCount, experienceCount, changeCount, draftCount, updatedThisWeek] = await Promise.all([
      prisma.knowledgeArticle.count({ where: { deletedAt: null } }),
      prisma.drawingLibraryItem.count({ where: { deletedAt: null } }),
      prisma.connectorAssemblyManual.count({ where: { deletedAt: null } }),
      prisma.connectorParameter.count({ where: { deletedAt: null } }),
      prisma.processDefinition.count({ where: { isActive: true } }),
      prisma.issue.count({ where: { deletedAt: null, status: 'closed' } }),
      prisma.changeRequest.count({ where: { deletedAt: null } }),
      prisma.knowledgeArticle.count({ where: { deletedAt: null, status: 'draft' } }),
      prisma.knowledgeArticle.count({ where: { deletedAt: null, updatedAt: { gte: weekAgo } } }),
    ]);
    const overview: KnowledgeOverviewDTO = {
      totalSources: articleCount + drawingCount + manualCount + parameterCount + processCount + experienceCount + changeCount,
      articleCount,
      drawingCount,
      manualCount,
      parameterCount,
      processCount,
      experienceCount,
      changeCount,
      draftCount,
      updatedThisWeek,
    };
    return NextResponse.json({ ok: true, overview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('knowledge overview failed', error);
    return NextResponse.json({ ok: false, error: '知识概览加载失败' }, { status: 500 });
  }
}
