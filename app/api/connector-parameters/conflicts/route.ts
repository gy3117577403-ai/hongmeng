import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { connectorConflictDetail } from '@/lib/connector-parameter-conflicts';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const sp = req.nextUrl.searchParams, page = Math.max(1, Math.min(100000, Number(sp.get('page')) || 1));
    const status = sp.get('status') === 'RESOLVED' ? 'RESOLVED' : 'PENDING';
    const keyword = (sp.get('keyword') || '').trim().slice(0, 100);
    const where = { status, ...(keyword ? { OR: [{ model: { contains: keyword, mode: 'insensitive' as const } }, { sourceEntry: { task: { specificationSnapshot: { contains: keyword, mode: 'insensitive' as const } } } }] } : {}) };
    const result = await prisma.$transaction(async tx => {
      const [total, pending, ids] = await Promise.all([tx.connectorParameterConflict.count({ where }), tx.connectorParameterConflict.count({ where: { status: 'PENDING' } }), tx.connectorParameterConflict.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20, skip: (Math.floor(page) - 1) * 20, select: { id: true } })]);
      const items = await Promise.all(ids.map(row => connectorConflictDetail(tx, row.id)));
      return { items, total, pending, page: Math.floor(page), totalPages: Math.max(1, Math.ceil(total / 20)) };
    }, { isolationLevel: 'RepeatableRead' });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) { if (e instanceof UnauthorizedError) return unauthorized(); console.error(e); return NextResponse.json({ ok: false, error: '参数待处理记录加载失败' }, { status: 500 }); }
}
