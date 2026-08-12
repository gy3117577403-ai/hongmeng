import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [terminalCount, bladeCount, publishedSetupCount, draftSetupCount, incompleteRows, tags] = await Promise.all([
      prisma.terminalToolingTerminal.count({ where: { isActive: true } }),
      prisma.terminalToolingBlade.count({ where: { isActive: true } }),
      prisma.terminalToolingSetup.count({ where: { status: 'PUBLISHED' } }),
      prisma.terminalToolingSetup.count({ where: { status: 'DRAFT' } }),
      prisma.terminalToolingSetup.findMany({
        where: { status: 'DRAFT' },
        select: { id: true, _count: { select: { positions: true } } },
      }),
      prisma.terminalToolingTag.findMany({
        where: { isActive: true },
        select: { label: true },
        orderBy: { label: 'asc' },
        take: 100,
      }),
    ]);
    return NextResponse.json({
      ok: true,
      stats: {
        terminalCount,
        bladeCount,
        publishedSetupCount,
        draftSetupCount,
        incompleteSetupCount: incompleteRows.filter(item => item._count.positions < 4).length,
      },
      tags: tags.map(tag => tag.label),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '端子调模概览加载失败' }, { status: 500 });
  }
}
