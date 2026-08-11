import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { activateProcessRouteChange } from '@/lib/process-route-change-service';
import {
  canReviewProcessRouteChanges,
  processRouteChangeActor,
  processRouteChangeErrorResponse,
} from '@/lib/process-route-change-api';
import { processRouteChangeDTO } from '@/lib/process-route-change-contract';
import { dispatchProcessRouteChangeOutboxBestEffort } from '@/lib/process-route-change-notifications';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    if (!canReviewProcessRouteChanges(user)) return forbidden('只有工艺更新权限可启用工艺变更');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const data = await activateProcessRouteChange({
      changeId: params.id,
      expectedVersion: body.expectedVersion,
      expectedRouteVersion: body.expectedRouteVersion,
      userId: user.id,
      actor: processRouteChangeActor(user),
      idempotencyKey: body.idempotencyKey,
    });
    await dispatchProcessRouteChangeOutboxBestEffort({ changeId: data.id, limit: 2 });
    return NextResponse.json({ ok: true, data: processRouteChangeDTO(data) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    return processRouteChangeErrorResponse(error, '工艺变更启用失败');
  }
}
