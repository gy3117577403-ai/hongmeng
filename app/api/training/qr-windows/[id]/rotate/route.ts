import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { trainingApiError } from '@/lib/training-api';
import { TrainingQrError, type TrainingQrPurpose } from '@/lib/training-qr';
import { createTrainingQrWindow } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.trainingQrWindow.findUnique({
      where: { id: params.id },
      select: { id: true, sessionId: true, purpose: true },
    });
    if (!current || !['CHECK_IN', 'FEEDBACK'].includes(current.purpose)) {
      throw new TrainingQrError('二维码窗口不存在', 404, 'TRAINING_QR_WINDOW_NOT_FOUND');
    }
    const result = await createTrainingQrWindow({
      sessionId: current.sessionId,
      purpose: current.purpose as TrainingQrPurpose,
      actorId: user.id,
    });
    await logOp({
      userId: user.id,
      action: 'rotate_training_qr_window',
      targetType: 'training_qr_window',
      targetId: result.window.id,
      detail: { previousWindowId: current.id, sessionId: current.sessionId, purpose: current.purpose, generation: result.window.generation },
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return trainingApiError(error, '培训二维码重新生成失败', 'rotate training qr window failed');
  }
}
