import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cleanProductTimeText, productTimeTotalMilliseconds } from '@/lib/product-time';
import type { ProductTimeCopySourceDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = cleanProductTimeText(req.nextUrl.searchParams.get('keyword'), 100);
    const excludeItemId = cleanProductTimeText(req.nextUrl.searchParams.get('excludeItemId'), 80);
    const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 40);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 80) : 40;

    const profiles = await prisma.productTimeProfile.findMany({
      where: {
        status: 'published',
        entries: { some: {} },
        ...(excludeItemId ? { drawingLibraryItemId: { not: excludeItemId } } : {}),
        drawingLibraryItem: {
          deletedAt: null,
          ...(keyword ? {
            OR: [
              { customerName: { contains: keyword, mode: 'insensitive' } },
              { customerCode: { contains: keyword, mode: 'insensitive' } },
              { specification: { contains: keyword, mode: 'insensitive' } },
              { productName: { contains: keyword, mode: 'insensitive' } },
            ],
          } : {}),
        },
      },
      select: {
        id: true,
        drawingLibraryItemId: true,
        version: true,
        publishedAt: true,
        updatedAt: true,
        drawingLibraryItem: {
          select: {
            customerName: true,
            customerCode: true,
            specification: true,
            productName: true,
          },
        },
        entries: {
          select: { unitMilliseconds: true },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    const sources: ProductTimeCopySourceDTO[] = profiles.map(profile => ({
      profileId: profile.id,
      drawingLibraryItemId: profile.drawingLibraryItemId,
      version: profile.version,
      customerName: profile.drawingLibraryItem.customerName,
      customerCode: profile.drawingLibraryItem.customerCode,
      specification: profile.drawingLibraryItem.specification,
      productName: profile.drawingLibraryItem.productName,
      processCount: profile.entries.length,
      totalMillisecondsPerUnit: productTimeTotalMilliseconds(profile.entries),
      publishedAt: profile.publishedAt?.toISOString() || null,
      updatedAt: profile.updatedAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, sources });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time copy sources failed', error);
    return NextResponse.json({ ok: false, error: '已发布产品路线加载失败' }, { status: 500 });
  }
}
