import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { trainingApiError } from '@/lib/training-api';
import { TRAINING_QR_PURPOSES, TrainingQrError, type TrainingQrPurpose } from '@/lib/training-qr';
import { createTrainingQrWindow } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const purpose = String(body.purpose || '').trim() as TrainingQrPurpose;
    if (!TRAINING_QR_PURPOSES.includes(purpose)) {
      throw new TrainingQrError('请选择签到或课后反馈二维码', 400, 'TRAINING_QR_PURPOSE_INVALID');
    }
    const result = await createTrainingQrWindow({ sessionId: params.id, purpose, actorId: user.id });
    await logOp({
      userId: user.id,
      action: purpose === 'CHECK_IN' ? 'open_training_check_in_qr' : 'open_training_feedback_qr',
      targetType: 'training_session',
      targetId: params.id,
      detail: { qrWindowId: result.window.id, generation: result.window.generation, purpose },
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return trainingApiError(error, '培训二维码开放失败', 'open training qr window failed');
  }
}
