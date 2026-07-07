import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { syncWorkOrderFilesToDrawingLibrary } from '@/lib/drawing-library-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await syncWorkOrderFilesToDrawingLibrary(params.id, user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '同步到图纸资料库失败';
    const status = message.includes('未设置规格') ? 400 : message.includes('不存在') ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
