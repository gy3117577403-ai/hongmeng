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
  assertFieldReportJsonMutation,
  canAttemptFieldReportCompletion,
  clearFieldReportPinSessionCookie,
  FieldReportPinAuthError,
  resolveFieldReportPinCompletionPrincipal,
  resolveFieldReportTerminal,
} from '@/lib/field-report-pin-auth';
import {
  completeProcessStep,
  completeProcessStepsBatch,
  ProcessCompletionServiceError,
} from '@/lib/process-completion-service';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
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
  let pinMode = false;
  let terminalMode = false;
  try {
    assertFieldReportJsonMutation(req);
    const terminal = await resolveFieldReportTerminal();
    terminalMode = Boolean(terminal);
    const pinPrincipal = terminal
      ? await resolveFieldReportPinCompletionPrincipal(params.code, terminal)
      : null;
    if (terminal && !pinPrincipal) {
      throw new FieldReportPinAuthError(
        '请重新验证员工编号和 PIN',
        401,
        'FIELD_REPORT_PIN_REQUIRED',
      );
    }
    pinMode = Boolean(pinPrincipal);
    const user = terminal ? null : await requireUser({ write: 'labor' });
    const currentEmployee = pinPrincipal?.employee || (user?.employeeId
      ? await prisma.employee.findFirst({
          where: { id: user.employeeId, ...productionEmployeeWhere() },
          select: { id: true, employeeNo: true, name: true },
        })
      : null);
    if (!currentEmployee) {
      return NextResponse.json(
        { ok: false, error: '当前账号未关联有效生产员工，不能提交现场报工', code: 'FIELD_REPORT_EMPLOYEE_REQUIRED' },
        { status: 403 },
      );
    }
    const ticket = await loadFieldReportTicket(params.code);
    if (!ticket.route || !canAttemptFieldReportCompletion({
      routeAvailable: true,
      canReport: ticket.access.canReport,
      pinSessionConsumed: Boolean(pinPrincipal?.consumedAt),
    })) {
      return NextResponse.json(
        { ok: false, error: ticket.access.message, code: 'FIELD_REPORT_READ_ONLY' },
        { status: 409 },
      );
    }
    const body = await req.json().catch(() => ({})) as {
      stepId?: unknown;
      processedQty?: unknown;
      defectQty?: unknown;
      defectDisposition?: unknown;
      workDate?: unknown;
      employeeIds?: unknown;
      team?: unknown;
      workstation?: unknown;
      remark?: unknown;
      idempotencyKey?: unknown;
      expectedRouteVersion?: unknown;
      items?: unknown;
    };
    const employeeIds = ensureFieldReportParticipants(currentEmployee.id, body.employeeIds);
    const common = {
      routeId: ticket.route.id,
      workDate: body.workDate,
      employeeIds,
      team: body.team,
      workstation: body.workstation,
      remark: body.remark,
      requireParticipants: true,
      allowAdvanceReporting: true,
      autoAssignLabor: true,
      reportSource: pinPrincipal
        ? ProcessCompletionSource.SHARED_TERMINAL_PIN
        : ProcessCompletionSource.QR_MOBILE,
      idempotencyKey: body.idempotencyKey,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: pinPrincipal?.userId || user!.id,
      actor: `${currentEmployee.employeeNo} · ${currentEmployee.name}`,
      principalEmployeeId: pinPrincipal?.employee.id,
      fieldReportTerminalId: pinPrincipal?.terminalId,
      pinCredentialVersion: pinPrincipal?.credentialVersion,
      fieldReportPinSession: pinPrincipal ? {
        sessionId: pinPrincipal.sessionId,
        tokenHash: pinPrincipal.tokenHash,
        terminalId: pinPrincipal.terminalId,
        terminalVersion: pinPrincipal.terminalVersion,
        credentialId: pinPrincipal.credentialId,
        credentialVersion: pinPrincipal.credentialVersion,
        employeeId: pinPrincipal.employee.id,
        userId: pinPrincipal.userId,
        ticketId: pinPrincipal.ticketId,
      } : undefined,
    };
    const data = Array.isArray(body.items)
      ? await completeProcessStepsBatch({
          ...common,
          items: body.items as Array<{
            stepId: unknown;
            processedQty: unknown;
            defectQty?: unknown;
            defectDisposition?: unknown;
          }>,
        })
      : await completeProcessStep({
          ...common,
          stepId: body.stepId,
          processedQty: body.processedQty,
          defectQty: body.defectQty,
          defectDisposition: body.defectDisposition,
        });
    const response = NextResponse.json({ ok: true, data });
    if (pinPrincipal) clearFieldReportPinSessionCookie(response);
    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ForbiddenError) {
      response = forbidden(error.message);
    } else if (error instanceof FieldReportPinAuthError) {
      response = NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    } else if (error instanceof UnauthorizedError) {
      response = unauthorized();
    } else if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionServiceError) {
      response = NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    } else {
      console.error('field report completion failed', error);
      response = NextResponse.json({ ok: false, error: '现场报工保存失败，请刷新后重试' }, { status: 500 });
    }
    if (
      (pinMode || terminalMode)
      && (
        error instanceof FieldReportPinAuthError
        || (error instanceof ProcessCompletionServiceError && error.status === 401)
      )
    ) clearFieldReportPinSessionCookie(response);
    return response;
  }
}
