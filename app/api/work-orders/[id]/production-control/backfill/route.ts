import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError, ForbiddenError, forbidden } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { prisma } from '@/lib/prisma';
import { canManageProductionControl, ProductionControlError, productionDateKey } from '@/lib/production-control';
import { visibleProductionControlOrder } from '@/lib/production-control-service';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';
import { completeProcessStep, ProcessCompletionServiceError } from '@/lib/process-completion-service';
import { completeProcessSupplementObligation, ProcessRouteChangeServiceError } from '@/lib/process-route-change-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    if (!canManageProductionControl(user)) return forbidden('只有有权管理该工单的主管、计划或管理员可以确认补录');
    const order = await visibleProductionControlOrder(user, params.id);
    const body = await req.json() as Record<string, unknown>;
    const startedAt = new Date(String(body.workStartedAt || ''));
    const endedAt = new Date(String(body.workEndedAt || ''));
    const reason = String(body.reason || '').trim();
    const requestId = String(body.idempotencyKey || '').trim();
    if (!reason || reason.length > 500 || !requestId || body.confirmHistoricalWork !== true
      || !Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
      throw new ProductionControlError('请填写真实作业起止时间、补录原因，并确认工作在暂停前已完成');
    }
    const route = await prisma.workOrderProcessRoute.findFirst({ where: {
      id: String(body.routeId || ''), workOrder: { deletedAt: null, OR: [{ id: order.id }, { rootWorkOrderId: order.id }] },
    } });
    if (!route) throw new ProductionControlError('工艺路线不属于当前暂停批次', 'PRODUCTION_BACKFILL_ROUTE_INVALID', 403);
    const authorization = { requestId, actorId: user.id, actorName: user.displayName || user.username, reason,
      workStartedAt: startedAt, workEndedAt: endedAt, expectedPauseAt: String(body.expectedPauseAt || '') };
    const command = { routeId: route.id, stepId: body.stepId,
      processedQty: body.processedQty, defectQty: body.defectQty, reportedUnitQty: body.reportedUnitQty,
      reportedDefectUnitQty: body.reportedDefectUnitQty, defectDisposition: body.defectDisposition,
      workDate: productionDateKey(startedAt), workStartedAt: startedAt.toISOString(), workEndedAt: endedAt.toISOString(),
      employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds.map(String) : [], remark: `暂停前工作补录：${reason}`,
      idempotencyKey: requestId, expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id, actor: authorization.actorName, requireParticipants: true, autoAssignLabor: true,
    };
    if (!order.productionPausedAt) {
      const replay = await prisma.processCompletion.findUnique({ where: { idempotencyKey: requestId }, select: { id: true } });
      if (!replay) throw new ProductionControlError('当前工单未暂停，请使用正常报工流程', 'PRODUCTION_BACKFILL_NOT_PAUSED', 409);
    }
    const data = body.obligationId
      ? await completeProcessSupplementObligation({ ...command, obligationId: String(body.obligationId),
          expectedVersion: body.expectedObligationVersion }, authorization)
      : await completeProcessStep(command, authorization);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof ProductionControlError || error instanceof ProductionAccessScopeError
      || error instanceof ProcessCompletionServiceError || error instanceof ProcessRouteChangeServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production backfill', error);
    return NextResponse.json({ ok: false, error: '暂停前工作补录失败' }, { status: 500 });
  }
}
