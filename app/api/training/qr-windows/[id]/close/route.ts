import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { trainingApiError } from '@/lib/training-api';
import { closeTrainingQrWindow } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const revoke = body.revoke === true;
    const window = await closeTrainingQrWindow({ windowId: params.id, actorId: user.id, revoke });
    await logOp({
      userId: user.id,
      action: revoke ? 'revoke_training_qr_window' : 'close_training_qr_window',
      targetType: 'training_qr_window',
      targetId: params.id,
      detail: { sessionId: window.sessionId, purpose: window.purpose, generation: window.generation },
    });
    return NextResponse.json({ ok: true, window });
  } catch (error) {
    return trainingApiError(error, '培训二维码关闭失败', 'close training qr window failed');
  }
}
