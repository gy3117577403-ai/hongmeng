import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseManualInput, parseVersionInput, serializeManual } from '@/lib/connector-assembly-manuals';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function activeRelations() {
  return {
    versions: {
      where: { deletedAt: null },
      include: { assets: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] } },
      orderBy: [{ isLatest: 'desc' as const }, { issuedAt: 'desc' as const }, { createdAt: 'desc' as const }],
    },
    bindings: {
      where: { connectorParameter: { deletedAt: null } },
      include: { connectorParameter: true },
      orderBy: { createdAt: 'asc' as const },
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const keyword = String(sp.get('keyword') || '').trim();
    const manufacturer = String(sp.get('manufacturer') || '').trim();
    const family = String(sp.get('family') || '').trim();
    const model = String(sp.get('model') || '').trim();
    const includeDeleted = sp.get('includeDeleted') === 'true';
    const latestOnly = sp.get('latestOnly') === 'true';
    const page = Math.max(1, Number(sp.get('page') || 1) || 1);
    const pageSize = Math.max(10, Math.min(50, Number(sp.get('pageSize') || 20) || 20));
    const AND: Prisma.ConnectorAssemblyManualWhereInput[] = [];
    if (!includeDeleted) AND.push({ deletedAt: null });
    if (manufacturer) AND.push({ manufacturer: { contains: manufacturer, mode: 'insensitive' } });
    if (family) AND.push({ family: { contains: family, mode: 'insensitive' } });
    if (model) AND.push({ bindings: { some: { connectorParameter: { model: { contains: model, mode: 'insensitive' }, deletedAt: null } } } });
    if (latestOnly) AND.push({ versions: { some: { isLatest: true, deletedAt: null } } });
    if (keyword) {
      AND.push({
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { manufacturer: { contains: keyword, mode: 'insensitive' } },
          { family: { contains: keyword, mode: 'insensitive' } },
          { documentNo: { contains: keyword, mode: 'insensitive' } },
          { summary: { contains: keyword, mode: 'insensitive' } },
          { keywords: { contains: keyword, mode: 'insensitive' } },
          { versions: { some: { deletedAt: null, OR: [{ revision: { contains: keyword, mode: 'insensitive' } }, { searchText: { contains: keyword, mode: 'insensitive' } }] } } },
          { versions: { some: { deletedAt: null, assets: { some: { deletedAt: null, originalName: { contains: keyword, mode: 'insensitive' } } } } } },
          { bindings: { some: { connectorParameter: { deletedAt: null, model: { contains: keyword, mode: 'insensitive' } } } } },
        ],
      });
    }
    const where: Prisma.ConnectorAssemblyManualWhereInput = AND.length ? { AND } : {};
    const [total, manuals, manufacturers, families] = await Promise.all([
      prisma.connectorAssemblyManual.count({ where }),
      prisma.connectorAssemblyManual.findMany({
        where,
        include: activeRelations(),
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.connectorAssemblyManual.findMany({ where: { deletedAt: null, manufacturer: { not: null } }, distinct: ['manufacturer'], select: { manufacturer: true }, orderBy: { manufacturer: 'asc' } }),
      prisma.connectorAssemblyManual.findMany({ where: { deletedAt: null, family: { not: null } }, distinct: ['family'], select: { family: true }, orderBy: { family: 'asc' } }),
    ]);
    return NextResponse.json({
      ok: true,
      manuals: manuals.map(serializeManual),
      total,
      page,
      pageSize,
      filters: {
        manufacturers: manufacturers.map(item => item.manufacturer).filter(Boolean),
        families: families.map(item => item.family).filter(Boolean),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '组装说明书加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const manualInput = parseManualInput(body);
    const revision = String(body.revision ?? '').trim();
    const versionInput = revision ? parseVersionInput(body) : { data: {}, errors: [] as string[] };
    const errors = [...manualInput.errors, ...versionInput.errors];
    if (errors.length) return NextResponse.json({ ok: false, error: errors.join('；') }, { status: 400 });
    const connectorParameterIds = Array.isArray(body.connectorParameterIds)
      ? Array.from(new Set(body.connectorParameterIds.map(value => String(value)).filter(Boolean))).slice(0, 500)
      : [];
    if (connectorParameterIds.length) {
      const count = await prisma.connectorParameter.count({ where: { id: { in: connectorParameterIds }, deletedAt: null } });
      if (count !== connectorParameterIds.length) return NextResponse.json({ ok: false, error: '部分关联连接器参数不存在或已删除' }, { status: 400 });
    }
    const userName = user.displayName || user.username;
    const manual = await prisma.connectorAssemblyManual.create({
      data: {
        ...manualInput.data,
        title: manualInput.data.title || '',
        createdBy: userName,
        versions: revision ? { create: { ...versionInput.data, revision, fileMode: versionInput.data.fileMode || 'PDF', createdBy: userName, isLatest: true } } : undefined,
        bindings: connectorParameterIds.length ? { create: connectorParameterIds.map(connectorParameterId => ({ connectorParameterId })) } : undefined,
      },
      include: activeRelations(),
    });
    await logOp({
      userId: user.id,
      action: 'create_connector_assembly_manual',
      targetType: 'connector_assembly_manual',
      targetId: manual.id,
      detail: { title: manual.title, revision: revision || null, bindingCount: connectorParameterIds.length },
    });
    if (connectorParameterIds.length) {
      await logOp({ userId: user.id, action: 'bind_connector_assembly_manual', targetType: 'connector_assembly_manual', targetId: manual.id, detail: { count: connectorParameterIds.length, source: 'create' } });
    }
    return NextResponse.json({ ok: true, manual: serializeManual(manual) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return NextResponse.json({ ok: false, error: '同一说明书的版本号不能重复' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ ok: false, error: '新增组装说明书失败' }, { status: 500 });
  }
}
