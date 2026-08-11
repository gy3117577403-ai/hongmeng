import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { productTimeProfileInclude, serializeProductTimeProfile } from '@/lib/product-time';
import {
  publishProductTimeDeployment,
  ProductTimeDeploymentError,
} from '@/lib/product-time-deployment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedRevision = Number(body.expectedRevision);
    const previewToken = typeof body.previewToken === 'string' ? body.previewToken.trim() : '';
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || !previewToken) {
      return NextResponse.json(
        { ok: false, error: '请先保存并预览当前产品工序与工时草稿' },
        { status: 400 },
      );
    }
    const result = await publishProductTimeDeployment({
      itemId: params.itemId,
      actorId: user.id,
      expectedRevision,
      previewToken,
    });
    const profile = await prisma.productTimeProfile.findUnique({
      where: { id: result.profileId },
      include: productTimeProfileInclude,
    });
    return NextResponse.json({
      ok: true,
      profile: profile ? serializeProductTimeProfile(profile) : null,
      deployment: result.deployment,
    });
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
    console.error('publish product time deployment failed', error);
    return NextResponse.json({ ok: false, error: '产品工序与工时发布及同步失败' }, { status: 500 });
  }
}
