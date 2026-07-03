import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { ids?: unknown; action?: unknown };
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.map(id => String(id || '').trim()).filter(Boolean))).slice(0, 200)
      : [];
    const action = String(body.action || '');
    if (!ids.length) return NextResponse.json({ ok: false, error: '请先选择参数行' }, { status: 400 });
    if (!['highlight', 'unhighlight', 'delete'].includes(action)) return NextResponse.json({ ok: false, error: '批量操作类型不支持' }, { status: 400 });

    const userName = user.displayName || user.username;
    if (action === 'delete') {
      const result = await prisma.connectorParameter.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: userName },
      });
      await logOp({
        userId: user.id,
        action: 'batch_delete_connector_parameters',
        targetType: 'connector_parameter',
        detail: { count: result.count },
      });
      return NextResponse.json({ ok: true, count: result.count });
    }

    const isHighlighted = action === 'highlight';
    const result = await prisma.connectorParameter.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { isHighlighted, updatedBy: userName },
    });
    await logOp({
      userId: user.id,
      action: 'batch_update_connector_parameters',
      targetType: 'connector_parameter',
      detail: { count: result.count, isHighlighted },
    });
    return NextResponse.json({ ok: true, count: result.count });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '批量操作失败' }, { status: 500 });
  }
}

export const PATCH = POST;
