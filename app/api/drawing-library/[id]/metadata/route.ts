import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getOrCreateSopDocument, lockSopScope } from '@/lib/sop/server';
import { SOP_WRITE_ACCESS, SopRequestError } from '@/lib/sop';
import { sopRouteError } from '@/lib/sop/http';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser({ write: SOP_WRITE_ACCESS });
    const body = await request.json();
    if (body.sopStage !== undefined && !['standard', 'new_product', 'validating'].includes(body.sopStage)) throw new SopRequestError('资料阶段无效');
    if (body.needsConfirmation !== undefined && typeof body.needsConfirmation !== 'boolean') throw new SopRequestError('确认状态无效');
    if (body.sopStage === undefined && body.needsConfirmation === undefined) throw new SopRequestError('请选择资料状态');
    await prisma.$transaction(async tx => {
      await lockSopScope(tx, params.id);
      const product = await tx.drawingLibraryItem.findFirst({ where: { id: params.id, deletedAt: null } });
      if (!product) throw new SopRequestError('资料不存在');
      if (body.sopStage !== undefined) {
        const { document } = await getOrCreateSopDocument(tx, params.id, user.id);
        await tx.sopDocument.update({ where: { id: document.id }, data: { sopStage: body.sopStage, updatedById: user.id } });
      }
      await tx.drawingLibraryItem.update({ where: { id: params.id }, data: {
        ...(body.needsConfirmation !== undefined ? { needsConfirmation: body.needsConfirmation } : {}), updatedAt: new Date(),
      } });
      await tx.operationLog.create({ data: { userId: user.id, action: 'update_drawing_quick_status', targetType: 'drawing_library_item', targetId: params.id,
        detail: { sopStage: body.sopStage, needsConfirmation: body.needsConfirmation } } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return sopRouteError(error, '保存资料状态失败'); }
}
