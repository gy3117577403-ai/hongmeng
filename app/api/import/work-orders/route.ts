import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireUser();
    return NextResponse.json({
      ok: false,
      error: '请先使用导入预览，再确认导入。',
      previewUrl: '/api/import/work-orders/preview',
      commitUrl: '/api/import/work-orders/commit',
    }, { status: 400 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '导入入口不可用' }, { status: 500 });
  }
}
