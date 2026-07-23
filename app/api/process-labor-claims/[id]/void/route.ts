import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ProcessLaborServiceError,
  voidProcessLaborClaim,
} from '@/lib/process-labor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser({ write: 'labor' });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await voidProcessLaborClaim({
      claimId: params.id,
      expectedPoolVersion: body.expectedPoolVersion,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessLaborServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('process labor claim void failed', error);
    return NextResponse.json({ ok: false, error: '领取冲销失败' }, { status: 500 });
  }
}
