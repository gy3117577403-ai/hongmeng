import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadProductionOrderById, serializeProductionOrder } from '@/lib/production-execution';
import {
  loadProcessRoute,
  parseProcessRouteAction,
  ProcessRouteServiceError,
  updateProcessRoute,
} from '@/lib/process-route-service';
import { serializeProcessRoute } from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const route = await loadProcessRoute(params.id);
    if (!route) return NextResponse.json({ ok: false, error: '工艺路线不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, route: serializeProcessRoute(route) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process route detail failed', error);
    return NextResponse.json({ ok: false, error: '工艺路线详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as {
      action?: unknown;
      version?: unknown;
      steps?: unknown;
      remark?: unknown;
    };
    const action = parseProcessRouteAction(body.action);
    if (!action) return NextResponse.json({ ok: false, error: '工艺路线操作不正确' }, { status: 400 });
    const actor = user.displayName || user.username;
    await updateProcessRoute(action === 'replace_steps'
      ? {
          routeId: params.id,
          action,
          expectedVersion: body.version,
          steps: body.steps,
          userId: user.id,
          actor,
        }
      : action === 'confirm'
        ? {
            routeId: params.id,
            action,
            expectedVersion: body.version,
            userId: user.id,
            actor,
          }
        : {
            routeId: params.id,
            action,
            expectedVersion: body.version,
            remark: body.remark,
            userId: user.id,
            actor,
          });
    const route = await loadProcessRoute(params.id);
    const workOrder = route ? await loadProductionOrderById(route.workOrderId) : null;
    return NextResponse.json({
      ok: true,
      route: route ? serializeProcessRoute(route) : null,
      workOrder: workOrder ? serializeProductionOrder(workOrder) : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessRouteServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('process route update failed', error);
    return NextResponse.json({ ok: false, error: '工艺路线更新失败' }, { status: 500 });
  }
}
