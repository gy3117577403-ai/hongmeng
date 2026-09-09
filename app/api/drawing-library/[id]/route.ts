import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireSystemAdministrator, ForbiddenError, unauthorized, UnauthorizedError } from '@/lib/auth';
import { cleanDrawingText, drawingLibraryKey, invalidSpecificationReason, parseCustomerCode, serializeDrawingLibraryItem } from '@/lib/drawing-library';
import { getDrawingLibraryReferenceImpact } from '@/lib/drawing-library-lifecycle';
import { changeDrawingLibraryLifecycle } from '@/lib/drawing-library-admin';
import { DrawingLibraryResolutionError, findDrawingProductCandidates, lockDrawingProduct } from '@/lib/drawing-library-resolution';
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
    where: { isCurrent: true, status: 'PUBLISHED', retiredAt: null },
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
    const item = await prisma.$transaction(async tx => {
      await lockDrawingProduct(tx, data);
      await tx.$queryRaw`SELECT id FROM drawing_library_items WHERE id = ${old.id} FOR UPDATE`;
      const current = await tx.drawingLibraryItem.findUnique({ where: { id: old.id } });
      if (!current || current.deletedAt || current.updatedAt.getTime() !== old.updatedAt.getTime()) throw new DrawingLibraryResolutionError('档案已变化，请刷新后重试');
      if (customerName !== old.customerName || specification !== old.specification) {
        const impact = await getDrawingLibraryReferenceImpact(tx, old.id);
        if (impact.blocked || impact.linkedPlanOrders || impact.linkedWorkOrders) throw new DrawingLibraryResolutionError('档案已有资料或业务引用，不能修改客户和型号；请使用原档案或新建不同产品');
        const others = (await findDrawingProductCandidates(tx, data)).filter(candidate => candidate.id !== old.id);
        if (others.length) throw new DrawingLibraryResolutionError('该客户和型号已有档案（含回收站），请使用或恢复原档案', undefined, others.map(candidate => candidate.id));
      }
      return tx.drawingLibraryItem.update({ where: { id: old.id }, data, include: includeFiles });
    });
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    await logOp({ userId: user.id, action: 'update_drawing_library_item', targetType: 'drawing_library_item', targetId: item.id, detail: { libraryKey: item.libraryKey } });
    return NextResponse.json({ ok: true, item: serializeDrawingLibraryItem(item, categories) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof DrawingLibraryResolutionError) return NextResponse.json({ ok: false, error: e.message, code: e.code, itemIds: e.itemIds }, { status: 409 });
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '该客户和规格已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireSystemAdministrator();
    const body = await req.json().catch(() => ({}));
    const result = await changeDrawingLibraryLifecycle(params.id, user.id, 'delete', typeof body.reason === 'string' ? body.reason : '');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以删除图纸档案' }, { status: 403 });
    if (e instanceof DrawingLibraryResolutionError) return NextResponse.json({ ok: false, error: e.message, code: e.code, itemIds: e.itemIds }, { status: e.code === 'DRAWING_LIBRARY_NOT_FOUND' ? 404 : 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录删除失败' }, { status: 500 });
  }
}
