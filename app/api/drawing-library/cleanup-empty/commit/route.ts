import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE } from '@/lib/drawing-library-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireUser();
    return NextResponse.json({
      ok: false,
      code: DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE,
      error: '产品资料主档（包括空主档）必须长期保留，空资料清理已停用。',
    }, { status: 405 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '空图纸资料清理失败' }, { status: 500 });
  }
}
