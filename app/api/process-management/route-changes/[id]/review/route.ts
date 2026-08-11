import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { reviewProcessRouteChange } from '@/lib/process-route-change-service';
import {
  canReviewProcessRouteChanges,
  processRouteChangeActor,
  processRouteChangeErrorResponse,
} from '@/lib/process-route-change-api';
import { processRouteChangeDTO } from '@/lib/process-route-change-contract';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    if (!canReviewProcessRouteChanges(user)) return forbidden('只有工艺更新权限可审核工艺变更');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === 'reject' ? 'reject' : body.action === 'approve' ? 'approve' : null;
    if (!action) return NextResponse.json({ ok: false, error: '审核动作不正确' }, { status: 400 });
    const data = await reviewProcessRouteChange({
      changeId: params.id,
      action,
      reviewReason: body.reviewReason,
      affectedQty: body.affectedQty,
      newStandardMillisecondsPerUnit: body.newStandardMillisecondsPerUnit,
      timeChanges: body.timeChanges,
      expectedVersion: body.expectedVersion,
      userId: user.id,
      actor: processRouteChangeActor(user),
      idempotencyKey: body.idempotencyKey,
    });
    await dispatchProcessRouteChangeOutbox({ changeId: data.id, limit: 2 });
    return NextResponse.json({ ok: true, data: processRouteChangeDTO(data) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    return processRouteChangeErrorResponse(error, '工艺变更审核失败');
  }
}
