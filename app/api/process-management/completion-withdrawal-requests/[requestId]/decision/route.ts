import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import {
  processCompletionWithdrawalWorkOrderWhere,
  resolveProcessCompletionWithdrawalScope,
} from '@/lib/process-completion-withdrawal-access';
import {
  decideProcessCompletionWithdrawalRequest,
  ProcessCompletionWithdrawalError,
} from '@/lib/process-completion-withdrawal-service';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const user = await requireUser({ write: 'production' });
    if (!hasCapability(user.access, 'PRODUCTION', 'UPDATE')) {
      return forbidden('仅管理员、生产主管或组长可审批报工撤回');
    }
    const scope = resolveProcessCompletionWithdrawalScope(user);
    const body = await req.json().catch(() => ({})) as {
      action?: unknown;
      expectedVersion?: unknown;
      expectedRouteVersion?: unknown;
      idempotencyKey?: unknown;
      note?: unknown;
    };
    const data = await decideProcessCompletionWithdrawalRequest({
      requestId: params.requestId,
      action: body.action,
      expectedVersion: body.expectedVersion,
      expectedRouteVersion: body.expectedRouteVersion,
      idempotencyKey: body.idempotencyKey,
      note: body.note,
      userId: user.id,
      actor: user.displayName || user.username,
      workOrderWhere: processCompletionWithdrawalWorkOrderWhere(scope),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof ProcessCompletionWithdrawalError || error instanceof ProductionAccessScopeError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('process completion withdrawal request decision failed', error);
    return NextResponse.json(
      { ok: false, error: '撤回申请审批失败', code: 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_DECISION_FAILED' },
      { status: 500 },
    );
  }
}
