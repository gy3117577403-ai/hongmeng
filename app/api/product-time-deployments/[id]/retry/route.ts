import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  retryProductTimeDeployment,
  ProductTimeDeploymentError,
} from '@/lib/product-time-deployment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workOrderIds = Array.isArray(body.workOrderIds)
      ? [...new Set(body.workOrderIds.map(String).map(value => value.trim()).filter(Boolean))]
      : undefined;
    const deployment = await retryProductTimeDeployment({
      deploymentId: params.id,
      actorId: user.id,
      workOrderIds,
    });
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductTimeDeploymentError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          deployment: error.deployment,
        },
        { status: error.status },
      );
    }
    console.error('retry product time deployment failed', error);
    return NextResponse.json({ ok: false, error: '产品工序与工时部署重试失败' }, { status: 500 });
  }
}
