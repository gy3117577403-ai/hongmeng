import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  reconcilePublishedProductTimeDeployment,
  ProductTimeDeploymentError,
} from '@/lib/product-time-deployment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Legacy compatibility route. The main UI now uses preview -> publish ->
 * deployment retry. This endpoint calibrates the complete scope for an older
 * already-published profile; it is no longer limited to work in progress.
 */
export async function POST(_req: Request, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const deployment = await reconcilePublishedProductTimeDeployment({
      itemId: params.itemId,
      actorId: user.id,
    });
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductTimeDeploymentError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('reconcile published product time deployment failed', error);
    return NextResponse.json({ ok: false, error: '已发布产品工序与工时校准失败' }, { status: 500 });
  }
}
