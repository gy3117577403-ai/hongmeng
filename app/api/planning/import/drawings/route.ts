import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { drawingCustomerIdentity, normalizeProductText } from '@/lib/drawing-product-identity';
import { sameImportCustomer } from '@/lib/import-drawing-association';
import { productTimeTotalMilliseconds } from '@/lib/product-time';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const customer = (req.nextUrl.searchParams.get('customer') || '').trim().slice(0, 160);
    const keyword = normalizeProductText((req.nextUrl.searchParams.get('q') || '').slice(0, 180));
    const selected = (req.nextUrl.searchParams.get('selected') || '').slice(0, 80);
    if (!customer) return NextResponse.json({ ok: false, error: '请选择本行客户' }, { status: 400 });
    const name = drawingCustomerIdentity(customer).name;
    // Use the same normalization as import identity; numeric customer suffixes
    // are codes, meaningful location suffixes remain part of the customer name.
    const ids = await prisma.$queryRaw<{id: string}[]>(Prisma.sql`
      SELECT id FROM drawing_library_items WHERE deleted_at IS NULL
      AND trim(regexp_replace(lower(trim(regexp_replace(normalize(customer_name, NFKC), '[[:space:]]+', ' ', 'g'))), '[[:space:]]*\\([0-9]+\\)$', '')) = ${name}
      AND (${keyword} = '' OR position(${keyword} in lower(normalize(specification, NFKC))) > 0 OR id = ${selected})
      ORDER BY (id = ${selected}) DESC, specification, id LIMIT 101
    `);
    const records = await prisma.drawingLibraryItem.findMany({
      where: { id: { in: ids.map(item => item.id) }, deletedAt: null },
      select: {
        id: true, libraryKey: true, customerName: true, customerCode: true, specification: true, productName: true, updatedAt: true,
        files: { where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing', 'sop'] } } }, orderBy: { createdAt: 'desc' },
          select: { id: true, originalName: true, displayName: true, mimeType: true, version: true, category: { select: { code: true } } } },
        productTimeProfiles: { where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1, select: { entries: { select: { unitMilliseconds: true } } } },
      },
    });
    const items = records.filter(item => sameImportCustomer(item.customerName, customer)).sort((a, b) => ids.findIndex(item => item.id === a.id) - ids.findIndex(item => item.id === b.id)).slice(0, 100).map(item => ({
      ...item, updatedAt: item.updatedAt.toISOString(), productTimeProfiles: undefined,
      productUnitMilliseconds: item.productTimeProfiles[0]?.entries.length ? productTimeTotalMilliseconds(item.productTimeProfiles[0].entries) : null,
      drawingFileCount: item.files.filter(file => file.category.code === 'drawing').length,
      sopFileCount: item.files.filter(file => file.category.code === 'sop').length,
      files: item.files.map(file => ({ id: file.id, name: file.displayName || file.originalName, mimeType: file.mimeType, version: file.version || 'V1.0', category: file.category.code })),
    }));
    return NextResponse.json({ ok: true, items, hasMore: ids.length > 100 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    console.error(error);
    return NextResponse.json({ ok: false, error: '资料档案读取失败，请重试' }, { status: 500 });
  }
}
