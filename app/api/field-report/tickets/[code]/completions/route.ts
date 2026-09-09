import { ProcessCompletionSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  completeProcessStepsBatch,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { submitProcessCompletion, reportingSubmissionReason } from '@/lib/process-report-submissions';
import type { ReportingSourceInput } from '@/lib/process-report-submission-contract';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  ensureFieldReportParticipants,
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'FIELD_REPORT_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const user = await requireUser({ write: 'labor' });
    const currentEmployee = user.employeeId
      ? await prisma.employee.findFirst({
          where: { id: user.employeeId, ...productionEmployeeWhere() },
          select: { id: true, employeeNo: true, name: true },
        })
      : null;
    if (!currentEmployee) {
      return NextResponse.json(
        { ok: false, error: '当前账号未关联有效生产员工，不能提交现场报工', code: 'FIELD_REPORT_EMPLOYEE_REQUIRED' },
        { status: 403 },
      );
    }
    const ticket = await loadFieldReportTicket(params.code);
    if (!ticket.route) {
      return NextResponse.json(
        { ok: false, error: ticket.access.message, code: 'FIELD_REPORT_READ_ONLY' },
        { status: 409 },
      );
    }
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
      items?: unknown;
      allowPending?: boolean;
      source?: ReportingSourceInput;
      expectedUserId?: unknown;
    };
    const employeeIds = ensureFieldReportParticipants(currentEmployee.id, body.employeeIds);
    if (Array.isArray(body.items) && !ticket.access.canReport) return NextResponse.json({ ok: false, error: ticket.access.message, code: 'FIELD_REPORT_READ_ONLY' }, { status: 409 });
    if (body.expectedUserId != null && body.expectedUserId !== user.id) {
      return NextResponse.json({ ok: false, error: '当前登录账号已变化，请核对账号后重新打开报工页面', code: 'ACCOUNT_CHANGED' }, { status: 409 });
    }
    const common = {
      routeId: ticket.route.id,
      workDate: body.workDate,
      employeeIds,
      team: body.team,
      workstation: body.workstation,
      remark: body.remark,
      requireParticipants: true,
      autoAssignLabor: true,
      reportSource: ProcessCompletionSource.QR_MOBILE,
      idempotencyKey: body.idempotencyKey,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id,
      actor: `${currentEmployee.employeeNo} · ${currentEmployee.name}`,
      principalEmployeeId: currentEmployee.id,
      wipAllocationId: body.wipAllocationId,
    };
    const data = Array.isArray(body.items)
      ? await completeProcessStepsBatch({
          ...common,
          items: body.items as Array<{
            stepId: unknown;
            processedQty: unknown;
            defectQty?: unknown;
            reportedUnitQty?: unknown;
            reportedDefectUnitQty?: unknown;
            defectDisposition?: unknown;
          }>,
        })
      : await submitProcessCompletion({
          ...common,
          ticketCode: params.code,
          reportingAccessAllowed: ticket.access.canReport,
          allowPending: body.allowPending === true,
          source: body.source,
          expectedUserId: body.expectedUserId,
          stepId: body.stepId,
          processedQty: body.processedQty,
          defectQty: body.defectQty,
          reportedUnitQty: body.reportedUnitQty,
          reportedDefectUnitQty: body.reportedDefectUnitQty,
          defectDisposition: body.defectDisposition,
        });
    if ('pending' in data && data.pending) return NextResponse.json({ ok: true, pending: true, submission: data.submission }, { status: 202 });
    const completed = 'pending' in data ? data.data : data;
    const completionIds = 'items' in completed ? completed.items.map(item => item.result.completionId) : [completed.completionId];
    const personal = await prisma.processLaborClaim.aggregate({ where: { employeeId: currentEmployee.id,
      status: 'ACTIVE', pool: { completionId: { in: completionIds } } }, _sum: { standardLaborMilliseconds: true } });
    return NextResponse.json({ ok: true, data: { ...completed, workDate: body.workDate,
      personalLaborMilliseconds: Number(personal._sum.standardLaborMilliseconds || 0n) } });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return forbidden(error.message);
    }
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, canSubmitPending: !!reportingSubmissionReason(error) },
        { status: error.status },
      );
    }
    console.error('field report completion failed', error);
    return NextResponse.json({ ok: false, error: '现场报工保存失败，请刷新后重试' }, { status: 500 });
  }
}
