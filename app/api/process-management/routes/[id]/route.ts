import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProcessRoute,
  parseProcessRouteAction,
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

export async function PATCH(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as {
      action?: unknown;
    };
    const action = parseProcessRouteAction(body.action);
    if (!action) return NextResponse.json({ ok: false, error: '工艺路线操作不正确' }, { status: 400 });
    return NextResponse.json({
      ok: false,
      error: action === 'advance'
        ? '旧转序入口已停用，请在生产调度中心使用“完成当前工序并转序”'
        : '旧工艺编排方式已下线，请在产品工序与工时中维护并发布',
      code: action === 'advance' ? 'PROCESS_COMPLETION_REQUIRED' : 'PROCESS_ROUTE_LEGACY_ACTION_DISABLED',
    }, { status: 410 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process route update failed', error);
    return NextResponse.json({ ok: false, error: '工艺路线更新失败' }, { status: 500 });
  }
}
