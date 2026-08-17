import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  previewProductTimeDeployment,
  ProductTimeDeploymentError,
} from '@/lib/product-time-deployment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { itemId: string } }) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const preview = await previewProductTimeDeployment(params.itemId, undefined, body.policies);
    // Business conflicts are a successful preview result. The client needs the
    // complete impact/conflict list to explain why publish is blocked.
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductTimeDeploymentError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('preview product time deployment failed', error);
    return NextResponse.json({ ok: false, error: '产品工序与工时发布预览失败' }, { status: 500 });
  }
}
