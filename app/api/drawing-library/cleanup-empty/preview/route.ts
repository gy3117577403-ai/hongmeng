import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { previewEmptyDrawingLibraryCleanup } from '@/lib/drawing-library-cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireUser();
    const summary = await previewEmptyDrawingLibraryCleanup();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '空图纸资料预览失败' }, { status: 500 });
  }
}
