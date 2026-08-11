import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { getProductTimeDeployment } from '@/lib/product-time-deployment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const deployment = await getProductTimeDeployment(params.id);
    if (!deployment) {
      return NextResponse.json({ ok: false, error: '部署记录不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deployment });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('load product time deployment failed', error);
    return NextResponse.json({ ok: false, error: '部署记录加载失败' }, { status: 500 });
  }
}
