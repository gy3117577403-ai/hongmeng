import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productionPlanChangeInclude, serializeProductionPlanChange } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const planOrderId = String(req.nextUrl.searchParams.get('planOrderId') || '').trim();
    const changes = await prisma.productionPlanChange.findMany({
      where: planOrderId ? { planOrderId } : undefined,
      include: productionPlanChangeInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({ ok: true, changes: changes.map(serializeProductionPlanChange) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('planning changes failed', error);
    return NextResponse.json({ ok: false, error: '计划变更记录加载失败' }, { status: 500 });
  }
}
