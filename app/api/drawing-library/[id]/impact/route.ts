import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { getDrawingLibraryReferenceImpact } from '@/lib/drawing-library-lifecycle';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const item = await prisma.drawingLibraryItem.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        customerName: true,
        specification: true,
        productName: true,
        deletedAt: true,
      },
    });
    if (!item) return NextResponse.json({ ok: false, error: '图纸资料记录不存在' }, { status: 404 });
    const impact = await prisma.$transaction(tx => getDrawingLibraryReferenceImpact(tx, item.id));
    return NextResponse.json({ ok: true, item, impact });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '图纸资料引用检查失败' }, { status: 500 });
  }
}
