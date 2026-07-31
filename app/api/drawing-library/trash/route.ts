import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const itemId = String(req.nextUrl.searchParams.get('itemId') || '').trim();
    const keyword = String(req.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 120);
    const items = await prisma.drawingLibraryItem.findMany({
      where: {
        deletedAt: { not: null },
        ...(itemId ? { id: itemId } : {}),
        ...(!itemId && keyword
          ? {
              OR: [
                { customerName: { contains: keyword, mode: 'insensitive' } },
                { specification: { contains: keyword, mode: 'insensitive' } },
                { productName: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        customerName: true,
        customerCode: true,
        productName: true,
        specification: true,
        libraryKey: true,
        deletedAt: true,
        updatedAt: true,
        _count: {
          select: {
            files: { where: { deletedAt: null } },
            productionPlanOrders: { where: { deletedAt: null } },
            workOrders: { where: { deletedAt: null } },
            productTimeProfiles: true,
          },
        },
      },
      orderBy: { deletedAt: 'desc' },
      take: itemId ? 1 : 100,
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '回收站加载失败' }, { status: 500 });
  }
}
