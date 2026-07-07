import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [items, files, categories] = await Promise.all([
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          customerName: true,
          customerCode: true,
          productName: true,
          specification: true,
          libraryKey: true,
        },
        orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
      }),
      prisma.drawingLibraryFile.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          libraryItemId: true,
          categoryId: true,
          originalName: true,
          displayName: true,
          size: true,
          sourceResourceFileId: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.resourceCategory.findMany({
        select: { id: true, name: true, code: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        items,
        files,
        categories,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '图纸资料库批量索引加载失败' }, { status: 500 });
  }
}
