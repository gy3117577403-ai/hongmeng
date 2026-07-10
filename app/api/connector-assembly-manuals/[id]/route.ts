import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseManualInput, serializeManual } from '@/lib/connector-assembly-manuals';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function relations(includeDeleted = false) {
  return {
    versions: {
      where: includeDeleted ? undefined : { deletedAt: null },
      include: { assets: { where: includeDeleted ? undefined : { deletedAt: null }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] } },
      orderBy: [{ isLatest: 'desc' as const }, { issuedAt: 'desc' as const }, { createdAt: 'desc' as const }],
    },
    bindings: { include: { connectorParameter: true }, orderBy: { createdAt: 'asc' as const } },
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const includeDeleted = req.nextUrl.searchParams.get('includeDeleted') === 'true';
    const manual = await prisma.connectorAssemblyManual.findFirst({
      where: { id: params.id, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: relations(includeDeleted),
    });
    if (!manual) return NextResponse.json({ ok: false, error: '组装说明书不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, manual: serializeManual(manual) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '组装说明书详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.connectorAssemblyManual.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '组装说明书不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const parsed = parseManualInput(body, { partial: true });
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const manual = await prisma.connectorAssemblyManual.update({ where: { id: params.id }, data: parsed.data, include: relations() });
    await logOp({ userId: user.id, action: 'update_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manual.id, detail: { title: manual.title } });
    return NextResponse.json({ ok: true, manual: serializeManual(manual) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '编辑组装说明书失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { confirmText?: string };
    if (String(body.confirmText || '').trim() !== 'DELETE_MANUAL') return NextResponse.json({ ok: false, error: '请输入 DELETE_MANUAL 确认删除' }, { status: 400 });
    const existing = await prisma.connectorAssemblyManual.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '组装说明书不存在或已删除' }, { status: 404 });
    const manual = await prisma.connectorAssemblyManual.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    await logOp({ userId: user.id, action: 'delete_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manual.id, detail: { title: manual.title } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '删除组装说明书失败' }, { status: 500 });
  }
}
