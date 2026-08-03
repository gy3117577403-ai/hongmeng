import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  previewProcessCompletionWithdrawal,
  ProcessCompletionWithdrawalError,
  withdrawProcessCompletion,
} from '@/lib/process-completion-withdrawal-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceError(error: ProcessCompletionWithdrawalError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

function canWithdraw(user: Awaited<ReturnType<typeof requireUser>>): boolean {
  return user.laborRole === 'ADMIN'
    || user.dailyPlanningRoles.includes('WORKSHOP_SUPERVISOR');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    const user = await requireUser();
    if (!canWithdraw(user)) return forbidden('仅管理员或生产主管可预览完工撤回影响');
    const data = await previewProcessCompletionWithdrawal(params.id, params.completionId);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionWithdrawalError) return serviceError(error);
    console.error('process completion withdrawal preview failed', error);
    return NextResponse.json({ ok: false, error: '完工撤回影响预览失败' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    const user = await requireUser({ write: 'production' });
    if (!canWithdraw(user)) return forbidden('仅管理员或生产主管可执行完工撤回');
    const body = await req.json().catch(() => ({})) as {
      expectedRouteVersion?: unknown;
      category?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    };
    const data = await withdrawProcessCompletion({
      routeId: params.id,
      completionId: params.completionId,
      expectedRouteVersion: body.expectedRouteVersion,
      category: body.category,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionWithdrawalError) return serviceError(error);
    console.error('process completion withdrawal failed', error);
    return NextResponse.json({ ok: false, error: '完工撤回失败' }, { status: 500 });
  }
}
