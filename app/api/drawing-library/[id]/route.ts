import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { cleanDrawingText, drawingLibraryKey, invalidSpecificationReason, parseCustomerCode, serializeDrawingLibraryItem } from '@/lib/drawing-library';
import { DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE, DRAWING_LIBRARY_MASTER_IMMUTABLE_MESSAGE } from '@/lib/drawing-library-lifecycle';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const includeFiles = {
  files: {
    where: { deletedAt: null },
    include: {
      category: { select: { id: true, name: true, code: true, sortOrder: true } },
      uploadedBy: { select: { displayName: true, username: true } },
      sourcePdfOverlayVersion: { select: { controlMode: true } },
      sourceSopVersion: { select: { controlMode: true } },
    },
    orderBy: [{ createdAt: 'desc' as const }],
  },
  productionPlanOrders: {
    where: { deletedAt: null },
    select: { id: true },
    take: 1,
  },
  productDataRecords: {
    where: { status: 'PUBLISHED' },
    orderBy: [{ kind: 'asc' as const }, { version: 'desc' as const }],
  },
  connectorBindings: {
    where: { isCurrent: true },
    include: { connectorParameter: true },
    orderBy: [{ version: 'desc' as const }],
  },
  sopDocument: {
    select: { id: true, sopStage: true, drawingStatus: true, remark: true, deletedAt: true, updatedAt: true },
  },
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const [item, categories] = await Promise.all([
      prisma.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null }, include: includeFiles }),
      prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    if (!item) return NextResponse.json({ ok: false, error: '图纸资料记录不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, item: serializeDrawingLibraryItem(item, categories) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!old) return NextResponse.json({ ok: false, error: '图纸资料记录不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const customerName = body.customerName !== undefined ? cleanDrawingText(body.customerName, 160) : old.customerName;
    if (!customerName) return NextResponse.json({ ok: false, error: '客户不能为空' }, { status: 400 });
    const specification = body.specification !== undefined ? cleanDrawingText(body.specification, 180) : old.specification;
    if (!specification) return NextResponse.json({ ok: false, error: '规格不能为空' }, { status: 400 });
    const specError = invalidSpecificationReason(specification);
    if (specError) return NextResponse.json({ ok: false, error: `规格格式异常：${specError}` }, { status: 400 });
    const data = {
      customerName,
      customerCode: parseCustomerCode(customerName),
      productName: body.productName !== undefined ? cleanDrawingText(body.productName, 180) : old.productName,
      specification,
      libraryKey: drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification),
      remark: body.remark !== undefined ? cleanDrawingText(body.remark, 500) : old.remark,
    };
    const item = await prisma.drawingLibraryItem.update({ where: { id: old.id }, data, include: includeFiles });
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    await logOp({ userId: user.id, action: 'update_drawing_library_item', targetType: 'drawing_library_item', targetId: item.id, detail: { libraryKey: item.libraryKey } });
    return NextResponse.json({ ok: true, item: serializeDrawingLibraryItem(item, categories) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '该客户和规格已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录保存失败' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await requireUser();
    return NextResponse.json({
      ok: false,
      code: DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE,
      error: DRAWING_LIBRARY_MASTER_IMMUTABLE_MESSAGE,
    }, {
      status: 405,
      headers: { Allow: 'GET, PATCH' },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录删除失败' }, { status: 500 });
  }
}
