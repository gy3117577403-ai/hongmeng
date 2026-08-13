import { ProcessCompletionSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  previewProcessCompletionWithdrawal,
  ProcessCompletionWithdrawalError,
  requestProcessCompletionCorrection,
  withdrawProcessCompletion,
} from '@/lib/process-completion-withdrawal-service';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function correctionContext(code: string, completionId: string, write = false) {
  const user = await requireUser(write ? { write: 'labor' } : undefined);
  const employee = user.employeeId
    ? await prisma.employee.findFirst({
        where: { id: user.employeeId, ...productionEmployeeWhere() },
        select: { id: true, employeeNo: true, name: true },
      })
    : null;
  if (!employee) return { user, employee: null, ticket: null, completion: null };
  const ticket = await loadFieldReportTicket(code);
  const completion = ticket.route
    ? await prisma.processCompletion.findFirst({
        where: {
          id: completionId,
          routeId: ticket.route.id,
          voidedAt: null,
        },
        select: {
          id: true,
          routeId: true,
          createdById: true,
          principalEmployeeId: true,
          reportSource: true,
          processedQty: true,
          completedAt: true,
          step: { select: { processName: true } },
        },
      })
    : null;
  return { user, employee, ticket, completion };
}

function correctionAvailable(ticket: Awaited<ReturnType<typeof loadFieldReportTicket>> | null): boolean {
  return Boolean(
    ticket?.route
    && ticket.access.state !== 'REVOKED'
    && ticket.access.state !== 'BLOCKED',
  );
}

function serviceError(error: ProcessCompletionWithdrawalError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string; completionId: string } },
) {
  try {
    const context = await correctionContext(params.code, params.completionId);
    if (!context.employee) return forbidden('当前账号未关联有效生产员工');
    if (!correctionAvailable(context.ticket)) {
      return NextResponse.json(
        { ok: false, error: context.ticket?.access.message || '当前工单不能报工' },
        { status: 409 },
      );
    }
    if (!context.completion) {
      return NextResponse.json(
        { ok: false, error: '报工记录不存在或已经撤回' },
        { status: 404 },
      );
    }
    const ownQrReport = context.completion.principalEmployeeId === context.employee.id
      || (
        context.completion.principalEmployeeId === null
        && context.completion.createdById === context.user.id
      );
    const ownMobileQrReport = ownQrReport
      && context.completion.reportSource === ProcessCompletionSource.QR_MOBILE;
    if (!ownMobileQrReport) {
      return NextResponse.json({
        ok: true,
        data: {
          ownership: 'OTHER',
          canRequestCorrection: true,
          completion: {
            id: context.completion.id,
            processName: context.completion.step.processName,
            processedQty: context.completion.processedQty,
            completedAt: context.completion.completedAt.toISOString(),
          },
        },
      });
    }
    const preview = await previewProcessCompletionWithdrawal(
      context.completion.routeId,
      context.completion.id,
    );
    return NextResponse.json({
      ok: true,
      data: { ownership: 'SELF', canRequestCorrection: true, preview },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionWithdrawalError) {
      return error instanceof ProcessCompletionWithdrawalError
        ? serviceError(error)
        : NextResponse.json(
            { ok: false, error: error.message, code: error.code },
            { status: error.status },
          );
    }
    console.error('field report correction preview failed', error);
    return NextResponse.json(
      { ok: false, error: '报工纠错影响预览失败' },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string; completionId: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const context = await correctionContext(params.code, params.completionId, true);
    if (!context.employee) return forbidden('当前账号未关联有效生产员工');
    if (!correctionAvailable(context.ticket)) {
      return NextResponse.json(
        { ok: false, error: context.ticket?.access.message || '当前工单不能报工' },
        { status: 409 },
      );
    }
    if (!context.completion) {
      return NextResponse.json(
        { ok: false, error: '报工记录不存在或已经撤回' },
        { status: 404 },
      );
    }
    const body = await req.json().catch(() => ({})) as {
      reason?: unknown;
      idempotencyKey?: unknown;
      expectedRouteVersion?: unknown;
    };
    const ownQrReport = context.completion.principalEmployeeId === context.employee.id
      || (
        context.completion.principalEmployeeId === null
        && context.completion.createdById === context.user.id
      );
    const ownMobileQrReport = ownQrReport
      && context.completion.reportSource === ProcessCompletionSource.QR_MOBILE;
    if (ownMobileQrReport) {
      const result = await withdrawProcessCompletion({
        routeId: context.completion.routeId,
        completionId: context.completion.id,
        expectedRouteVersion: body.expectedRouteVersion,
        category: 'REPORTING_ERROR',
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        userId: context.user.id,
        actor: `${context.employee.employeeNo} · ${context.employee.name}`,
      });
      return NextResponse.json({ ok: true, data: result });
    }
    const result = await requestProcessCompletionCorrection({
      routeId: context.completion.routeId,
      completionId: context.completion.id,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      userId: context.user.id,
      actor: `${context.employee.employeeNo} · ${context.employee.name}`,
    });
    return NextResponse.json({ ok: true, data: { status: 'REQUESTED', ...result } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionWithdrawalError) {
      return error instanceof ProcessCompletionWithdrawalError
        ? serviceError(error)
        : NextResponse.json(
            { ok: false, error: error.message, code: error.code },
            { status: error.status },
          );
    }
    console.error('field report correction failed', error);
    return NextResponse.json(
      { ok: false, error: '报工纠错提交失败，请刷新后重试' },
      { status: 500 },
    );
  }
}
