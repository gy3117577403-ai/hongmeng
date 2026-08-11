import { ProcessCompletionSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { completeProcessSupplementObligation } from '@/lib/process-route-change-service';
import { processRouteChangeErrorResponse } from '@/lib/process-route-change-api';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';
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
  { params }: { params: { code: string; id: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json({ ok: false, error: '请求格式错误', code: 'FIELD_SUPPLEMENT_JSON_REQUIRED' }, { status: 415 });
    }
    const user = await requireUser({ write: 'labor' });
    const employee = user.employeeId
      ? await prisma.employee.findFirst({
          where: { id: user.employeeId, ...productionEmployeeWhere() },
          select: { id: true, employeeNo: true, name: true },
        })
      : null;
    if (!employee) return forbidden('当前账号未关联有效生产员工，不能提交补充工序报工');
    const ticket = await loadFieldReportTicket(params.code, { recordScan: false });
    if (!ticket.route || ticket.ticketStatus !== 'ACTIVE') {
      return NextResponse.json({ ok: false, error: '当前二维码没有可报工的工艺路线', code: 'FIELD_SUPPLEMENT_ROUTE_REQUIRED' }, { status: 409 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeIds = ensureFieldReportParticipants(employee.id, body.employeeIds);
    const data = await completeProcessSupplementObligation({
      obligationId: params.id,
      routeId: ticket.route.id,
      publicCode: ticket.publicCode,
      expectedVersion: body.expectedVersion,
      expectedRouteVersion: body.expectedRouteVersion,
      processedQty: body.processedQty,
      defectQty: body.defectQty,
      defectDisposition: body.defectDisposition,
      workDate: body.workDate,
      employeeIds,
      team: body.team,
      workstation: body.workstation,
      remark: body.remark,
      reportSource: ProcessCompletionSource.SUPPLEMENT_OBLIGATION,
      principalEmployeeId: employee.id,
      userId: user.id,
      actor: `${employee.employeeNo} · ${employee.name}`,
      idempotencyKey: body.idempotencyKey,
    });
    if (data.changeId) {
      await dispatchProcessRouteChangeOutbox({ changeId: data.changeId, limit: 2 });
    }
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return processRouteChangeErrorResponse(error, '补充工序报工保存失败');
  }
}
