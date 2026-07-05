import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { parseConnectorParameterInput, serializeConnectorParameter } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function missingWhere(field: 'outerPeelMm' | 'innerPeelMm' | 'insertionLengthMm') {
  return { OR: [{ [field]: null }, { [field]: '' }] } as Prisma.ConnectorParameterWhereInput;
}

function whereFrom(req: NextRequest) {
  const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim();
  const missing = req.nextUrl.searchParams.get('missing') || '';
  const highlighted = req.nextUrl.searchParams.get('highlighted') === 'true';
  const AND: Prisma.ConnectorParameterWhereInput[] = [{ deletedAt: null }];
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
  if (missing === 'any') AND.push({ OR: [missingWhere('outerPeelMm'), missingWhere('innerPeelMm'), missingWhere('insertionLengthMm')] });
  return { AND };
}

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.max(20, Math.min(200, Number(req.nextUrl.searchParams.get('pageSize') || 80) || 80));
    const where = whereFrom(req);
    const [total, items] = await Promise.all([
      prisma.connectorParameter.count({ where }),
      prisma.connectorParameter.findMany({
        where,
        orderBy: [{ isHighlighted: 'desc' }, { rowNo: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return nativeOk({ parameters: items.map(serializeConnectorParameter), page, pageSize, total });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('连接器参数加载失败', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const body = await req.json().catch(() => ({}));
    const parsed = parseConnectorParameterInput(body);
    if (parsed.errors.length) return nativeError(parsed.errors.join('；'), 400);
    const userName = user.displayName || user.username;
    const item = await prisma.connectorParameter.create({
      data: {
        rowNo: parsed.data.rowNo,
        model: parsed.data.model,
        outerPeelMm: parsed.data.outerPeelMm,
        innerPeelMm: parsed.data.innerPeelMm,
        insertionLengthMm: parsed.data.insertionLengthMm,
        remark: parsed.data.remark,
        isHighlighted: parsed.data.isHighlighted,
        createdBy: userName,
        updatedBy: userName,
      },
    });
    await logOp({ userId: user.id, action: 'create_connector_parameter', targetType: 'connector_parameter', targetId: item.id, detail: { model: item.model, rowNo: item.rowNo, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'connector_parameter',
      entityId: item.id,
      action: 'create_connector_parameter',
      after: connectorParameterSnapshot(item),
      changedBy: userName,
    });
    return nativeOk({ parameter: serializeConnectorParameter(item) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('新增连接器参数失败', 500);
  }
}
