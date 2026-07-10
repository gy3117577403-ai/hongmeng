import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseConnectorParameterInput, serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function missingWhere(field: 'outerPeelMm' | 'innerPeelMm' | 'insertionLengthMm') {
  return { OR: [{ [field]: null }, { [field]: '' }] } as Prisma.ConnectorParameterWhereInput;
}

function whereFrom(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const keyword = (sp.get('keyword') || '').trim();
  const missing = sp.get('missing') || '';
  const highlighted = sp.get('highlighted') === 'true';
  const deleted = sp.get('deleted') === 'true';
  const AND: Prisma.ConnectorParameterWhereInput[] = [{ deletedAt: deleted ? { not: null } : null }];

  if (keyword) {
    AND.push({
      OR: [
        { model: { contains: keyword, mode: 'insensitive' } },
        { outerPeelMm: { contains: keyword, mode: 'insensitive' } },
        { innerPeelMm: { contains: keyword, mode: 'insensitive' } },
        { insertionLengthMm: { contains: keyword, mode: 'insensitive' } },
        { remark: { contains: keyword, mode: 'insensitive' } },
      ],
    });
  }
  if (highlighted) AND.push({ isHighlighted: true });
  if (missing === 'outer') AND.push(missingWhere('outerPeelMm'));
  if (missing === 'inner') AND.push(missingWhere('innerPeelMm'));
  if (missing === 'insertion') AND.push(missingWhere('insertionLengthMm'));
  if (missing === 'any') {
    AND.push({
      OR: [
        missingWhere('outerPeelMm'),
        missingWhere('innerPeelMm'),
        missingWhere('insertionLengthMm'),
      ],
    });
  }
  return { AND };
}

function orderBy(sort: string): Prisma.ConnectorParameterOrderByWithRelationInput[] {
  if (sort === 'updated_desc') return [{ updatedAt: 'desc' }];
  if (sort === 'created_desc') return [{ createdAt: 'desc' }];
  if (sort === 'highlighted') return [{ isHighlighted: 'desc' }, { rowNo: 'asc' }, { createdAt: 'asc' }];
  return [{ rowNo: 'asc' }, { createdAt: 'asc' }];
}

async function stats() {
  const base = { deletedAt: null };
  const [total, missingOuter, missingInner, missingInsertion, missingAny, highlighted, fileCount] = await Promise.all([
    prisma.connectorParameter.count({ where: base }),
    prisma.connectorParameter.count({ where: { ...base, ...missingWhere('outerPeelMm') } }),
    prisma.connectorParameter.count({ where: { ...base, ...missingWhere('innerPeelMm') } }),
    prisma.connectorParameter.count({ where: { ...base, ...missingWhere('insertionLengthMm') } }),
    prisma.connectorParameter.count({ where: { ...base, OR: [missingWhere('outerPeelMm'), missingWhere('innerPeelMm'), missingWhere('insertionLengthMm')] } }),
    prisma.connectorParameter.count({ where: { ...base, isHighlighted: true } }),
    prisma.connectorParameterFile.count({ where: { deletedAt: null } }),
  ]);
  return { total, missingOuter, missingInner, missingInsertion, missingAny, highlighted, fileCount };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.max(10, Math.min(200, Number(req.nextUrl.searchParams.get('pageSize') || 80) || 80));
    const where = whereFrom(req);
    const [total, items, stat] = await Promise.all([
      prisma.connectorParameter.count({ where }),
      prisma.connectorParameter.findMany({
        where,
        include: { _count: { select: { assemblyManualBindings: { where: { manual: { deletedAt: null } } } } } },
        orderBy: orderBy(req.nextUrl.searchParams.get('sort') || ''),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      stats(),
    ]);

    return NextResponse.json({
      ok: true,
      parameters: items.map(serializeConnectorParameter),
      page,
      pageSize,
      total,
      stats: stat,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '连接器参数加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const parsed = parseConnectorParameterInput(body);
    if (parsed.errors.length) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const userName = user.displayName || user.username;
    const item = await prisma.connectorParameter.create({
      data: {
        ...parsed.data,
        createdBy: userName,
        updatedBy: userName,
      },
    });
    await logOp({
      userId: user.id,
      action: 'create_connector_parameter',
      targetType: 'connector_parameter',
      targetId: item.id,
      detail: { model: item.model, rowNo: item.rowNo },
    });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'create_connector_parameter',
      after: connectorParameterSnapshot(item),
      changedBy: userName,
    });
    return NextResponse.json({ ok: true, parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '新增连接器参数失败' }, { status: 500 });
  }
}
