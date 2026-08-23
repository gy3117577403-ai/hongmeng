import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { trainingApiError } from '@/lib/training-api';
import { TrainingQrError } from '@/lib/training-qr';
import { startTrainingSession } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedVersion = Number(body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new TrainingQrError('课次版本不正确，请刷新后重试', 409, 'TRAINING_SESSION_VERSION_INVALID');
    }
    const result = await startTrainingSession({
      sessionId: params.id,
      actorId: user.id,
      expectedVersion,
    });
    await logOp({
      userId: user.id,
      action: 'start_training_session',
      targetType: 'training_session',
      targetId: params.id,
      detail: {
        idempotent: result.idempotent,
        actualStartAt: result.session.actualStartAt?.toISOString() || null,
      },
    });
    return NextResponse.json({
      ok: true,
      session: {
        id: result.session.id,
        status: result.session.status,
        actualStartAt: result.session.actualStartAt?.toISOString() || null,
        version: result.session.version,
      },
      idempotent: result.idempotent,
    });
  } catch (error) {
    return trainingApiError(error, '培训课次开始失败', 'start training session failed');
  }
}
