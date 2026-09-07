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
  loadProcessCompletionContext,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { submitProcessCompletion, reportingSubmissionReason } from '@/lib/process-report-submissions';
import type { ReportingSourceInput } from '@/lib/process-report-submission-contract';
import { prisma } from '@/lib/prisma';
import { processRouteChangeErrorResponse } from '@/lib/process-route-change-api';
import { dispatchProcessRouteChangeOutboxBestEffort } from '@/lib/process-route-change-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceError(error: ProcessCompletionServiceError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code, canSubmitPending: !!reportingSubmissionReason(error) },
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
      allowPending?: boolean;
      source?: ReportingSourceInput;
      expectedUserId?: unknown;
    };
    const actor = user.displayName || user.username;
    const obligation = body.obligationId ? await prisma.processSupplementObligation.findFirst({ where: { id: String(body.obligationId), routeId: params.id }, select: { id: true, displayStepId: true } }) : null;
    if (body.obligationId && !obligation) return NextResponse.json({ ok: false, error: '补充工序不属于此工单', code: 'PROCESS_SUPPLEMENT_REQUIRED' }, { status: 404 });
    const data = await submitProcessCompletion({
          obligationId: obligation?.id,
          expectedObligationVersion: body.expectedObligationVersion,
          allowPending: body.allowPending === true,
          source: body.source,
          expectedUserId: body.expectedUserId,
          routeId: params.id,
          stepId: obligation?.displayStepId || body.stepId,
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
    if (!data.pending && 'changeId' in data.data && typeof data.data.changeId === 'string') await dispatchProcessRouteChangeOutboxBestEffort({ changeId: data.data.changeId, limit: 2 });
    return data.pending ? NextResponse.json({ ok: true, pending: true, submission: data.submission }, { status: 202 })
      : NextResponse.json({ ok: true, data: data.data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof ProcessCompletionServiceError) return serviceError(error);
    return processRouteChangeErrorResponse(error, '生产完成记录保存失败');
  }
}
