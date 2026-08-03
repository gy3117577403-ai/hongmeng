import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { correctProcessCompletionStandard } from '@/lib/process-completion-correction-service';
import { ProcessCompletionWithdrawalError } from '@/lib/process-completion-withdrawal-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    const user = await requireUser({ write: 'production' });
    if (
      user.laborRole !== 'ADMIN'
      && !user.dailyPlanningRoles.includes('WORKSHOP_SUPERVISOR')
    ) return forbidden('仅管理员或生产主管可校正工序与标准工时');
    const body = await req.json().catch(() => ({})) as {
      expectedRouteVersion?: unknown;
      processName?: unknown;
      standardMillisecondsPerUnit?: unknown;
      idempotencyKey?: unknown;
    };
    const data = await correctProcessCompletionStandard({
      routeId: params.id,
      completionId: params.completionId,
      expectedRouteVersion: body.expectedRouteVersion,
      processName: body.processName,
      standardMillisecondsPerUnit: body.standardMillisecondsPerUnit,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionWithdrawalError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('process completion standard correction failed', error);
    return NextResponse.json({ ok: false, error: '工序与标准工时校正失败' }, { status: 500 });
  }
}
