import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cancelProcessCompletionWithdrawalRequest,
  createProcessCompletionWithdrawalRequest,
  listProcessCompletionWithdrawalRequests,
  previewProcessCompletionWithdrawal,
  ProcessCompletionWithdrawalError,
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
          participants: { select: { employeeId: true } },
          laborPool: {
            select: {
              claims: {
                where: { status: 'ACTIVE' },
                select: { employeeId: true },
              },
            },
          },
        },
      })
    : null;
  return { user, employee, ticket, completion };
}

function employeeCanRequest(
  context: Awaited<ReturnType<typeof correctionContext>>,
): boolean {
  if (!context.employee || !context.completion) return false;
  return context.completion.principalEmployeeId === context.employee.id
    || context.completion.createdById === context.user.id
    || context.completion.participants.some(item => item.employeeId === context.employee!.id)
    || (context.completion.laborPool?.claims || []).some(item => item.employeeId === context.employee!.id);
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
    if (!employeeCanRequest(context)) {
      return forbidden('只能查看和申请撤回本人主报或本人参与的报工');
    }
    const [preview, requestPage] = await Promise.all([
      previewProcessCompletionWithdrawal(context.completion.routeId, context.completion.id),
      listProcessCompletionWithdrawalRequests({
        completionId: context.completion.id,
        requesterUserId: context.user.id,
        take: 20,
      }),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        ownership: 'SELF',
        canRequestCorrection: true,
        completion: {
          id: context.completion.id,
          processName: context.completion.step.processName,
          processedQty: context.completion.processedQty,
          completedAt: context.completion.completedAt.toISOString(),
        },
        preview,
        requests: requestPage.items,
        activeRequest: requestPage.items.find(item => item.status === 'PENDING') || null,
      },
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
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'FIELD_REPORT_CORRECTION_JSON_REQUIRED' },
        { status: 415 },
      );
    }
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
    if (!employeeCanRequest(context)) {
      return forbidden('只能为本人主报或本人参与的报工提交撤回申请');
    }
    const request = await createProcessCompletionWithdrawalRequest({
      routeId: context.completion.routeId,
      completionId: context.completion.id,
      expectedRouteVersion: body.expectedRouteVersion,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      userId: context.user.id,
      employeeId: context.employee.id,
      actor: `${context.employee.employeeNo} · ${context.employee.name}`,
    });
    return NextResponse.json({ ok: true, data: { status: 'REQUESTED', request } }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: { code: string; completionId: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'FIELD_REPORT_CORRECTION_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const context = await correctionContext(params.code, params.completionId, true);
    if (!context.employee) return forbidden('当前账号未关联有效生产员工');
    if (!context.completion) {
      return NextResponse.json(
        { ok: false, error: '报工记录不存在或已经撤回' },
        { status: 404 },
      );
    }
    if (!employeeCanRequest(context)) {
      return forbidden('只能取消本人主报或本人参与报工的撤回申请');
    }
    const body = await req.json().catch(() => ({})) as {
      requestId?: unknown;
      expectedVersion?: unknown;
      idempotencyKey?: unknown;
    };
    const request = await cancelProcessCompletionWithdrawalRequest({
      requestId: typeof body.requestId === 'string' ? body.requestId : '',
      routeId: context.completion.routeId,
      completionId: context.completion.id,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey,
      userId: context.user.id,
      employeeId: context.employee.id,
    });
    return NextResponse.json({ ok: true, data: { status: 'CANCELLED', request } });
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError || error instanceof ProcessCompletionWithdrawalError) {
      return error instanceof ProcessCompletionWithdrawalError
        ? serviceError(error)
        : NextResponse.json(
            { ok: false, error: error.message, code: error.code },
            { status: error.status },
          );
    }
    console.error('field report correction cancellation failed', error);
    return NextResponse.json(
      { ok: false, error: '撤回申请取消失败，请刷新后重试' },
      { status: 500 },
    );
  }
}
