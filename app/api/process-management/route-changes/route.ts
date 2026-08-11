import { NextRequest, NextResponse } from 'next/server';
import { ProcessRouteChangeStatus } from '@prisma/client';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { listProcessRouteChanges } from '@/lib/process-route-change-service';
import {
  canReadProcessRouteChanges,
  processRouteChangeErrorResponse,
} from '@/lib/process-route-change-api';
import { processRouteChangeDTOs } from '@/lib/process-route-change-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!canReadProcessRouteChanges(user)) return forbidden('当前账号无权查看工艺变更');
    const routeId = String(req.nextUrl.searchParams.get('routeId') || '').trim();
    const status = String(req.nextUrl.searchParams.get('status') || '').trim();
    if (status && !Object.values(ProcessRouteChangeStatus).includes(status as ProcessRouteChangeStatus)) {
      return NextResponse.json({
        ok: false,
        error: '工艺变更状态不正确',
        code: 'PROCESS_ROUTE_CHANGE_STATUS_INVALID',
      }, { status: 400 });
    }
    const data = await listProcessRouteChanges({
      routeId: routeId || undefined,
      status: status ? status as ProcessRouteChangeStatus : undefined,
    });
    return NextResponse.json({ ok: true, data: processRouteChangeDTOs(data) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    return processRouteChangeErrorResponse(error, '工艺变更列表加载失败');
  }
}
