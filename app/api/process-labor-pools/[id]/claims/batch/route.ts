import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  claimProcessLaborPoolBatch,
  ProcessLaborServiceError,
} from '@/lib/process-labor-service';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { assertDailyPlanMutationRequest, dailyPlanError } from '@/lib/daily-plan-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(req);
    const user = await requireUser({ write: 'labor' });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await claimProcessLaborPoolBatch({
      poolId: params.id,
      allocations: body.allocations,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey || req.headers.get('idempotency-key'),
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === 'DailyPlanDisabledError') {
      return dailyPlanError(error, 'process labor batch claim');
    }
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessLaborServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('process labor batch claim failed', error);
    return NextResponse.json(
      { ok: false, error: '批量领取实际工时失败', code: 'PROCESS_LABOR_OPERATION_FAILED' },
      { status: 500 },
    );
  }
}
