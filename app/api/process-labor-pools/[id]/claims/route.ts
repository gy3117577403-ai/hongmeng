import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  claimProcessLaborPool,
  ProcessLaborServiceError,
} from '@/lib/process-labor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser({ write: 'labor' });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await claimProcessLaborPool({
      poolId: params.id,
      employeeId: body.employeeId,
      quantity: body.quantity,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessLaborServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('process labor claim failed', error);
    return NextResponse.json({ ok: false, error: '工时领取失败' }, { status: 500 });
  }
}
