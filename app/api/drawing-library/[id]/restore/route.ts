import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  getDrawingLibraryReferenceImpact,
  refreshRestoredDrawingWorkOrders,
} from '@/lib/drawing-library-lifecycle';
import { reconcileProductionPlanDrawingLinks } from '@/lib/planning-product-link';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.drawingLibraryItem.findUnique({
      where: { id: params.id },
      select: { id: true, libraryKey: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '图纸资料记录不存在' }, { status: 404 });

    const result = await prisma.$transaction(async tx => {
      await tx.drawingLibraryItem.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      });
      const repair = await reconcileProductionPlanDrawingLinks(tx, {
        drawingLibraryItemId: existing.id,
      });
      const refreshedWorkOrders = await refreshRestoredDrawingWorkOrders(tx, existing.id);
      const impact = await getDrawingLibraryReferenceImpact(tx, existing.id);
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'restore_drawing_library_item',
          targetType: 'drawing_library_item',
          targetId: existing.id,
          detail: {
            libraryKey: existing.libraryKey,
            linkedPlanOrders: repair.linkedOrders,
            unchangedPlanOrders: repair.unchangedOrders,
            unresolvedPlanOrders: repair.unresolvedOrders,
            refreshedWorkOrders,
          },
        },
      });
      return { repair: { ...repair, refreshedWorkOrders }, impact };
    });
    return NextResponse.json({ ok: true, itemId: existing.id, ...result });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸资料恢复和链路修复失败' }, { status: 500 });
  }
}
