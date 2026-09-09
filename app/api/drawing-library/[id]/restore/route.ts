import { NextResponse } from 'next/server';
import { requireSystemAdministrator, ForbiddenError, unauthorized, UnauthorizedError } from '@/lib/auth';
import { changeDrawingLibraryLifecycle } from '@/lib/drawing-library-admin';
import { DrawingLibraryResolutionError } from '@/lib/drawing-library-resolution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSystemAdministrator();
    const body = await req.json().catch(() => ({}));
    const result = await changeDrawingLibraryLifecycle(params.id, user.id, 'restore', typeof body.reason === 'string' ? body.reason : '');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以恢复图纸档案' }, { status: 403 });
    if (e instanceof DrawingLibraryResolutionError) return NextResponse.json({ ok: false, error: e.message, code: e.code, itemIds: e.itemIds }, { status: e.code === 'DRAWING_LIBRARY_NOT_FOUND' ? 404 : 409 });
    console.error(e);
    return NextResponse.json({ ok: false, error: '图纸档案恢复失败' }, { status: 500 });
  }
}
