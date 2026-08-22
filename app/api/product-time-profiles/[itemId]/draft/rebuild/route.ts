import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ProductTimeDraftSyncError,
  rebuildProductTimeDraftFromPublished,
} from '@/lib/product-time-draft-sync-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedRevision = Number(body.expectedRevision);
    const expectedPublishedVersion = Number(body.expectedPublishedVersion);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json(
        { ok: false, error: '草稿修订号无效，请刷新后重试', code: 'PRODUCT_TIME_DRAFT_REVISION_REQUIRED' },
        { status: 400 },
      );
    }
    if (!Number.isInteger(expectedPublishedVersion) || expectedPublishedVersion <= 0) {
      return NextResponse.json(
        { ok: false, error: '正式版本号无效，请刷新后重试', code: 'PRODUCT_TIME_PUBLISHED_VERSION_REQUIRED' },
        { status: 400 },
      );
    }
    const result = await rebuildProductTimeDraftFromPublished({
      itemId: params.itemId,
      actorId: user.id,
      expectedRevision,
      expectedPublishedVersion,
      confirmationText: String(body.confirmationText || ''),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductTimeDraftSyncError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('discard and rebuild product time draft failed', error);
    return NextResponse.json(
      { ok: false, error: '放弃草稿并重建失败', code: 'PRODUCT_TIME_DRAFT_REBUILD_FAILED' },
      { status: 500 },
    );
  }
}
