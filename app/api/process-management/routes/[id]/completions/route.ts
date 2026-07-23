import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  completeProcessStep,
  loadProcessCompletionContext,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceError(error: ProcessCompletionServiceError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser();
    const data = await loadProcessCompletionContext(
      params.id,
      req.nextUrl.searchParams.get('stepId'),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionServiceError) return serviceError(error);
    console.error('process completion context failed', error);
    return NextResponse.json(
      { ok: false, error: '生产完成上下文加载失败' },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as {
      stepId?: unknown;
      processedQty?: unknown;
      defectQty?: unknown;
      defectDisposition?: unknown;
      workDate?: unknown;
      workStartedAt?: unknown;
      workEndedAt?: unknown;
      employeeIds?: unknown;
      team?: unknown;
      workstation?: unknown;
      remark?: unknown;
      idempotencyKey?: unknown;
      expectedRouteVersion?: unknown;
    };
    const data = await completeProcessStep({
      routeId: params.id,
      stepId: body.stepId,
      processedQty: body.processedQty,
      defectQty: body.defectQty,
      defectDisposition: body.defectDisposition,
      workDate: body.workDate,
      workStartedAt: body.workStartedAt,
      workEndedAt: body.workEndedAt,
      employeeIds: body.employeeIds,
      team: body.team,
      workstation: body.workstation,
      remark: body.remark,
      requireParticipants: true,
      idempotencyKey: body.idempotencyKey,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionServiceError) return serviceError(error);
    console.error('process completion failed', error);
    return NextResponse.json(
      { ok: false, error: '生产完成记录保存失败' },
      { status: 500 },
    );
  }
}
