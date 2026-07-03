import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseConnectorParameterInput, serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const parsed = parseConnectorParameterInput(body, { partial: true });
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const existing = await prisma.connectorParameter.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '连接器参数不存在' }, { status: 404 });

    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: {
        ...parsed.data,
        updatedBy: user.displayName || user.username,
      },
    });
    await logOp({
      userId: user.id,
      action: 'update_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo, isHighlighted: item.isHighlighted },
    });
    return NextResponse.json({ ok: true, parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '更新连接器参数失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorParameter.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '连接器参数不存在' }, { status: 404 });
    const item = await prisma.connectorParameter.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), updatedBy: user.displayName || user.username },
    });
    await logOp({
      userId: user.id,
      action: 'delete_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '删除连接器参数失败' }, { status: 500 });
  }
}
