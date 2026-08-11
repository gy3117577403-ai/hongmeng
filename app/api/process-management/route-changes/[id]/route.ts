import { NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { getProcessRouteChange } from '@/lib/process-route-change-service';
import {
  canReadProcessRouteChanges,
  processRouteChangeErrorResponse,
} from '@/lib/process-route-change-api';
import { processRouteChangeDTO } from '@/lib/process-route-change-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!canReadProcessRouteChanges(user)) return forbidden('当前账号无权查看工艺变更');
    const data = await getProcessRouteChange(params.id);
    if (!data) return NextResponse.json({ ok: false, error: '工艺变更不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, data: processRouteChangeDTO(data) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    return processRouteChangeErrorResponse(error, '工艺变更详情加载失败');
  }
}
