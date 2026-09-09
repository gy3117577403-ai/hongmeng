import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireUser();
    return NextResponse.json({
      ok: false,
      code: 'DRAWING_LIBRARY_BULK_DELETE_DISABLED',
      error: '批量清理已停用，请管理员在图纸库中逐项检查引用后删除档案。',
    }, { status: 405 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '空图纸资料清理失败' }, { status: 500 });
  }
}
