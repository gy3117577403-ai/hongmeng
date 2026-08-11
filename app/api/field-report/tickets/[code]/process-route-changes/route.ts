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
import {
  createProcessRouteChangeProposal,
  listProcessRouteChanges,
  submitProcessRouteChange,
} from '@/lib/process-route-change-service';
import {
  processRouteChangeActor,
  processRouteChangeErrorResponse,
} from '@/lib/process-route-change-api';
import {
  processRouteChangeDTO,
  processRouteChangeDTOs,
} from '@/lib/process-route-change-contract';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  loadFieldReportTicket,
  WorkOrderQrServiceError,
} from '@/lib/work-order-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentProductionEmployee(userId: string | null | undefined) {
  return userId
    ? prisma.employee.findFirst({
        where: { id: userId, ...productionEmployeeWhere() },
        select: { id: true, employeeNo: true, name: true },
      })
    : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    const user = await requireUser();
    const employee = await currentProductionEmployee(user.employeeId);
    if (!employee) return forbidden('当前账号未关联有效生产员工');
    const ticket = await loadFieldReportTicket(params.code, { recordScan: false });
    if (!ticket.route) return NextResponse.json({ ok: true, data: [] });
    const data = await listProcessRouteChanges({ routeId: ticket.route.id });
    return NextResponse.json({ ok: true, data: processRouteChangeDTOs(data) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return processRouteChangeErrorResponse(error, '现场工艺变更列表加载失败');
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json({ ok: false, error: '请求格式错误', code: 'FIELD_ROUTE_CHANGE_JSON_REQUIRED' }, { status: 415 });
    }
    const user = await requireUser({ write: 'labor' });
    const employee = await currentProductionEmployee(user.employeeId);
    if (!employee) return forbidden('当前账号未关联有效生产员工，不能提交工艺变更');
    const ticket = await loadFieldReportTicket(params.code, { recordScan: false });
    if (!ticket.route || ticket.ticketStatus !== 'ACTIVE') {
      return NextResponse.json({ ok: false, error: '当前二维码没有可变更的工艺路线', code: 'FIELD_ROUTE_CHANGE_ROUTE_REQUIRED' }, { status: 409 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    const actor = `${employee.employeeNo} · ${employee.name}`;
    const created = await createProcessRouteChangeProposal({
      routeId: ticket.route.id,
      publicCode: ticket.publicCode,
      changeType: body.changeType,
      insertBeforeStepId: body.insertBeforeStepId,
      moveStepId: body.moveStepId,
      moveBeforeStepId: body.moveBeforeStepId,
      movePosition: body.movePosition,
      newProcessName: body.newProcessName,
      newStandardMillisecondsPerUnit: body.newStandardMillisecondsPerUnit,
      affectedQty: body.affectedQty ?? ticket.workOrder.targetQty,
      timeChanges: body.timeChanges,
      reason: body.reason,
      expectedVersion: body.expectedRouteVersion,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id,
      actor,
      idempotencyKey,
    });
    const submitted = await submitProcessRouteChange({
      changeId: created.id,
      expectedVersion: created.version,
      userId: user.id,
      actor: processRouteChangeActor(user) || actor,
      idempotencyKey: `${idempotencyKey}:submit`,
    });
    await dispatchProcessRouteChangeOutbox({ changeId: submitted.id, limit: 2 });
    return NextResponse.json({ ok: true, data: processRouteChangeDTO(submitted) }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof WorkOrderQrServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return processRouteChangeErrorResponse(error, '现场工艺变更提交失败');
  }
}
