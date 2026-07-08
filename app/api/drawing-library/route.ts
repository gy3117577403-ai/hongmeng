import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  cleanDrawingText,
  drawingLibraryKey,
  isVisibleDrawingLibraryItem,
  parseCustomerCode,
  serializeDrawingLibraryItem,
} from '@/lib/drawing-library';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function itemInclude() {
  return {
    files: {
      where: { deletedAt: null },
      include: {
        category: { select: { id: true, name: true, code: true, sortOrder: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
      orderBy: [{ createdAt: 'desc' as const }],
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = req.nextUrl.searchParams.get('keyword')?.trim() || '';
    const filter = req.nextUrl.searchParams.get('filter') || 'all';
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    const items = await prisma.drawingLibraryItem.findMany({
      where: {
        deletedAt: null,
        ...(keyword
          ? {
              OR: [
                { customerName: { contains: keyword, mode: 'insensitive' } },
                { productName: { contains: keyword, mode: 'insensitive' } },
                { specification: { contains: keyword, mode: 'insensitive' } },
                { remark: { contains: keyword, mode: 'insensitive' } },
                {
                  files: {
                    some: {
                      deletedAt: null,
                      OR: [
                        { originalName: { contains: keyword, mode: 'insensitive' } },
                        { displayName: { contains: keyword, mode: 'insensitive' } },
                        { remark: { contains: keyword, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: itemInclude(),
      orderBy: filter === 'recent' ? [{ updatedAt: 'desc' }] : [{ customerName: 'asc' }, { specification: 'asc' }],
      take: 600,
    });

    const serialized = items
      .filter(isVisibleDrawingLibraryItem)
      .map(item => serializeDrawingLibraryItem(item, categories));
    const filtered = serialized.filter(item => {
      if (filter === 'incomplete') return !item.isComplete;
      if (filter === 'missing_drawing') return item.missingRequiredCategories.includes('drawing');
      if (filter === 'missing_sop') return item.missingRequiredCategories.includes('sop');
      if (filter === 'missing_product') return item.missingRequiredCategories.includes('product');
      if (filter === 'complete') return item.isComplete;
      return true;
    });
    const customerMap = new Map<string, { customerName: string; customerCode: string | null; itemCount: number; missingCount: number }>();
    for (const item of filtered) {
      const key = item.customerName || '未设置';
      const current = customerMap.get(key) || { customerName: key, customerCode: item.customerCode || null, itemCount: 0, missingCount: 0 };
      current.itemCount += 1;
      if (!item.isComplete) current.missingCount += 1;
      if (!current.customerCode && item.customerCode) current.customerCode = item.customerCode;
      customerMap.set(key, current);
    }

    return NextResponse.json({
      items: filtered,
      customers: [
        { customerName: '全部客户', customerCode: null, itemCount: filtered.length, missingCount: filtered.filter(item => !item.isComplete).length },
        ...Array.from(customerMap.values()),
      ],
      categories: categories.map(category => ({ id: category.id, name: category.name, code: category.code, sortOrder: category.sortOrder })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料库加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const specification = cleanDrawingText(body.specification, 180);
    if (!specification) return NextResponse.json({ ok: false, error: '规格不能为空' }, { status: 400 });
    const customerName = cleanDrawingText(body.customerName, 160);
    if (!customerName) return NextResponse.json({ ok: false, error: '客户不能为空' }, { status: 400 });
    const productName = cleanDrawingText(body.productName, 180);
    const remark = cleanDrawingText(body.remark, 500);
    const libraryKey = drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification);
    const existing = await prisma.drawingLibraryItem.findUnique({ where: { libraryKey }, include: itemInclude() });
    if (existing && !existing.deletedAt) return NextResponse.json({ ok: false, error: '该客户和规格已存在' }, { status: 409 });

    const item = existing
      ? await prisma.drawingLibraryItem.update({
          where: { id: existing.id },
          data: { customerName, customerCode: parseCustomerCode(customerName), productName, specification, libraryKey, remark, deletedAt: null },
          include: itemInclude(),
        })
      : await prisma.drawingLibraryItem.create({
          data: { customerName, customerCode: parseCustomerCode(customerName), productName, specification, libraryKey, remark },
          include: itemInclude(),
        });
    const categories = await prisma.resourceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    await logOp({ userId: user.id, action: 'create_drawing_library_item', targetType: 'drawing_library_item', targetId: item.id, detail: { libraryKey } });
    return NextResponse.json({ ok: true, item: serializeDrawingLibraryItem(item, categories) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '该客户和规格已存在' }, { status: 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录创建失败' }, { status: 500 });
  }
}
