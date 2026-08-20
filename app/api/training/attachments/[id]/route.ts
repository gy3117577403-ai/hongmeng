import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const attachment = await prisma.trainingAttachment.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!attachment) return NextResponse.json({ ok: false, error: '附件不存在或已删除' }, { status: 404 });
    await prisma.$transaction(async tx => {
      await tx.trainingAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
      if (attachment.planId) {
        await tx.trainingActivity.create({ data: { planId: attachment.planId, action: 'delete_attachment', content: `删除附件：${attachment.originalName.slice(0, 160)}`, actorId: user.id, detail: { attachmentId: attachment.id } } });
        await tx.trainingPlan.update({ where: { id: attachment.planId }, data: { updatedById: user.id, version: { increment: 1 } } });
      }
    });
    await logOp({ userId: user.id, action: 'delete_training_attachment', targetType: 'training_attachment', targetId: attachment.id, detail: { planId: attachment.planId, kind: attachment.kind } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training attachment delete failed', error);
    return NextResponse.json({ ok: false, error: '培训附件删除失败' }, { status: 500 });
  }
}
