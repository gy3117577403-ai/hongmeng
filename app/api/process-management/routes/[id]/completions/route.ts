import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  completeProcessStep,
  loadProcessCompletionContext,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { completeProcessSupplementObligation } from '@/lib/process-route-change-service';
import { processRouteChangeErrorResponse } from '@/lib/process-route-change-api';
import { dispatchProcessRouteChangeOutboxBestEffort } from '@/lib/process-route-change-notifications';

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
      {},
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
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'PROCESS_COMPLETION_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const user = await requireUser({ write: 'production' });
    const body = await req.json().catch(() => ({})) as {
      stepId?: unknown;
      processedQty?: unknown;
      defectQty?: unknown;
      reportedUnitQty?: unknown;
      reportedDefectUnitQty?: unknown;
      defectDisposition?: unknown;
      workDate?: unknown;
      employeeIds?: unknown;
      team?: unknown;
      workstation?: unknown;
      remark?: unknown;
      idempotencyKey?: unknown;
      expectedRouteVersion?: unknown;
      wipAllocationId?: unknown;
      obligationId?: unknown;
      expectedObligationVersion?: unknown;
    };
    const actor = user.displayName || user.username;
    const data = body.obligationId
      ? await completeProcessSupplementObligation({
          obligationId: String(body.obligationId),
          routeId: params.id,
          expectedVersion: body.expectedObligationVersion,
          expectedRouteVersion: body.expectedRouteVersion,
          processedQty: body.processedQty,
          defectQty: body.defectQty,
          reportedUnitQty: body.reportedUnitQty,
          reportedDefectUnitQty: body.reportedDefectUnitQty,
          defectDisposition: body.defectDisposition,
          workDate: body.workDate,
          employeeIds: Array.isArray(body.employeeIds)
            ? body.employeeIds.map(employeeId => String(employeeId))
            : [],
          team: body.team,
          workstation: body.workstation,
          remark: body.remark,
          idempotencyKey: body.idempotencyKey,
          userId: user.id,
          actor,
        })
      : await completeProcessStep({
          routeId: params.id,
          stepId: body.stepId,
          processedQty: body.processedQty,
          defectQty: body.defectQty,
          reportedUnitQty: body.reportedUnitQty,
          reportedDefectUnitQty: body.reportedDefectUnitQty,
          defectDisposition: body.defectDisposition,
          workDate: body.workDate,
          employeeIds: body.employeeIds,
          team: body.team,
          workstation: body.workstation,
          remark: body.remark,
          requireParticipants: true,
          autoAssignLabor: true,
          wipAllocationId: body.wipAllocationId,
          idempotencyKey: body.idempotencyKey,
          expectedRouteVersion: body.expectedRouteVersion,
          userId: user.id,
          actor,
        });
    if ('changeId' in data && data.changeId) {
      await dispatchProcessRouteChangeOutboxBestEffort({ changeId: data.changeId, limit: 2 });
    }
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof ProcessCompletionServiceError) return serviceError(error);
    return processRouteChangeErrorResponse(error, '生产完成记录保存失败');
  }
}
