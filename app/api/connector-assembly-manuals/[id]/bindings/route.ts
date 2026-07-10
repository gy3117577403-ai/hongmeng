import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function idsFrom(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(item => String(item)).filter(Boolean))).slice(0, 500) : [];
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const bindings = await prisma.connectorAssemblyManualBinding.findMany({
      where: { manualId: params.id, manual: { deletedAt: null }, connectorParameter: { deletedAt: null } },
      include: { connectorParameter: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ ok: true, bindings: bindings.map(binding => ({ id: binding.connectorParameter.id, model: binding.connectorParameter.model, rowNo: binding.connectorParameter.rowNo, remark: binding.connectorParameter.remark })) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '关联型号加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const manual = await prisma.connectorAssemblyManual.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!manual) return NextResponse.json({ ok: false, error: '组装说明书不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { connectorParameterIds?: unknown; modelKeyword?: unknown };
    let connectorParameterIds = idsFrom(body.connectorParameterIds);
    const modelKeyword = String(body.modelKeyword ?? '').trim();
    if (modelKeyword) {
      const matches = await prisma.connectorParameter.findMany({ where: { deletedAt: null, model: { contains: modelKeyword, mode: 'insensitive' } }, select: { id: true }, take: 500 });
      connectorParameterIds = Array.from(new Set([...connectorParameterIds, ...matches.map(item => item.id)]));
    }
    if (!connectorParameterIds.length) return NextResponse.json({ ok: false, error: '请选择要关联的连接器参数' }, { status: 400 });
    const valid = await prisma.connectorParameter.findMany({ where: { id: { in: connectorParameterIds }, deletedAt: null }, select: { id: true } });
    if (valid.length !== connectorParameterIds.length) return NextResponse.json({ ok: false, error: '部分连接器参数不存在或已删除' }, { status: 400 });
    const result = await prisma.connectorAssemblyManualBinding.createMany({ data: valid.map(item => ({ manualId: manual.id, connectorParameterId: item.id })), skipDuplicates: true });
    await logOp({ userId: user.id, action: 'bind_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manual.id, detail: { count: result.count } });
    return NextResponse.json({ ok: true, count: result.count });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '关联连接器参数失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { connectorParameterIds?: unknown };
    const connectorParameterIds = idsFrom(body.connectorParameterIds);
    if (!connectorParameterIds.length) return NextResponse.json({ ok: false, error: '请选择要解除的连接器参数' }, { status: 400 });
    const result = await prisma.connectorAssemblyManualBinding.deleteMany({ where: { manualId: params.id, connectorParameterId: { in: connectorParameterIds } } });
    await logOp({ userId: user.id, action: 'unbind_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: params.id, detail: { count: result.count } });
    return NextResponse.json({ ok: true, count: result.count });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '解除连接器参数关联失败' }, { status: 500 });
  }
}
