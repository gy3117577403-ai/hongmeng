import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { correctProcessCompletionStandard } from '@/lib/process-completion-correction-service';
import { ProcessCompletionWithdrawalError } from '@/lib/process-completion-withdrawal-service';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'PROCESS_COMPLETION_CORRECTION_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const user = await requireUser({ write: 'production' });
    if (
      !hasCapability(user.access, 'PROCESS', 'UPDATE')
      && !hasCapability(user.access, 'PRODUCTION', 'UPDATE')
    ) return forbidden('当前账号无权校正工序与标准工时');
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
    if (error instanceof ForbiddenError) return forbidden(error.message);
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
