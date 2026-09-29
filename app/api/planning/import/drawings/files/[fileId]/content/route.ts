import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { isImportDrawingFile } from '@/lib/import-drawing-file';
import { GET as content, HEAD as head } from '@/app/api/drawing-library/files/[fileId]/content/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function serve(req: NextRequest, context: { params: { fileId: string } }, isHead: boolean) {
  try {
    await requireUser();
    if (!await isImportDrawingFile(context.params.fileId)) return NextResponse.json({ ok: false, error: '当前图纸资料已变化，请刷新重新选择' }, { status: 404 });
    return isHead ? head(req, context) : content(req, context);
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    console.error('import drawing preview failed', error);
    return NextResponse.json({ ok: false, error: '资料预览失败，请重试' }, { status: 500 });
  }
}
export async function GET(req: NextRequest, context: { params: { fileId: string } }) { return serve(req, context, false); }
export async function HEAD(req: NextRequest, context: { params: { fileId: string } }) { return serve(req, context, true); }
