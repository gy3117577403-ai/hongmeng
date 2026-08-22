import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ProductTimeDraftSyncError,
  syncProductTimeDraftToPublished,
} from '@/lib/product-time-draft-sync-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json(
        { ok: false, error: '草稿修订号无效，请刷新后重试', code: 'PRODUCT_TIME_DRAFT_REVISION_REQUIRED' },
        { status: 400 },
      );
    }
    const result = await syncProductTimeDraftToPublished({
      itemId: params.itemId,
      actorId: user.id,
      expectedRevision,
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
    console.error('sync product time draft with published failed', error);
    return NextResponse.json(
      { ok: false, error: '草稿同步最新正式版本失败', code: 'PRODUCT_TIME_DRAFT_SYNC_FAILED' },
      { status: 500 },
    );
  }
}
