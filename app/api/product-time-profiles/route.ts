import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cleanProductTimeText, productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = cleanProductTimeText(req.nextUrl.searchParams.get('keyword'), 100);
    const customer = cleanProductTimeText(req.nextUrl.searchParams.get('customer'), 120);
    const status = cleanProductTimeText(req.nextUrl.searchParams.get('status'), 20);
    const itemId = cleanProductTimeText(req.nextUrl.searchParams.get('itemId'), 80);
    const items = await prisma.drawingLibraryItem.findMany({
      where: {
        deletedAt: null,
        ...(itemId ? { id: itemId } : {}),
        ...(customer ? { customerName: customer } : {}),
        ...(keyword ? {
          OR: [
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { customerCode: { contains: keyword, mode: 'insensitive' } },
            { specification: { contains: keyword, mode: 'insensitive' } },
            { productName: { contains: keyword, mode: 'insensitive' } },
          ],
        } : {}),
        ...(status === 'missing' ? { productTimeProfiles: { none: { status: { in: ['draft', 'published'] } } } } : {}),
        ...(status === 'draft' ? { productTimeProfiles: { some: { status: 'draft' } } } : {}),
        ...(status === 'published' ? { productTimeProfiles: { some: { status: 'published' } } } : {}),
      },
      include: {
        productTimeProfiles: {
          where: { status: { in: ['draft', 'published'] } },
          orderBy: { version: 'desc' },
          include: productTimeProfileInclude,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { customerName: 'asc' }, { specification: 'asc' }],
      take: 800,
    });
    const rows = items.map(item => {
      const draft = item.productTimeProfiles.find(profile => profile.status === 'draft') || null;
      const published = item.productTimeProfiles.find(profile => profile.status === 'published') || null;
      return {
        id: item.id,
        customerName: item.customerName,
        customerCode: item.customerCode,
        specification: item.specification,
        productName: item.productName,
        updatedAt: item.updatedAt.toISOString(),
        draft: draft ? serializeProductTimeProfile(draft) : null,
        published: published ? serializeProductTimeProfile(published) : null,
      };
    });
    const definitions = await prisma.processDefinition.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, stageGroup: true, sortOrder: true },
    });
    const customers = await prisma.drawingLibraryItem.groupBy({
      by: ['customerName'],
      where: { deletedAt: null },
      _count: { _all: true },
      orderBy: { customerName: 'asc' },
    });
    return NextResponse.json({
      ok: true,
      items: rows,
      definitions,
      customers: customers.map(item => ({ customerName: item.customerName, count: item._count._all })),
      summary: {
        total: rows.length,
        published: rows.filter(item => item.published).length,
        draft: rows.filter(item => item.draft).length,
        missing: rows.filter(item => !item.published && !item.draft).length,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time profiles list failed', error);
    return NextResponse.json({ ok: false, error: '产品工时加载失败' }, { status: 500 });
  }
}
