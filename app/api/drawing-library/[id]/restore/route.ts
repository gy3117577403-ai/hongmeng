import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const item = await prisma.drawingLibraryItem.update({
      where: { id: params.id },
      data: { deletedAt: null },
    });
    await logOp({ userId: user.id, action: 'restore_drawing_library_item', targetType: 'drawing_library_item', targetId: item.id, detail: { libraryKey: item.libraryKey } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料记录恢复失败' }, { status: 500 });
  }
}
