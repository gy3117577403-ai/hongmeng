import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { isImportDrawingFile } from '@/lib/import-drawing-file';
import { GET as download } from '@/app/api/drawing-library/files/[fileId]/download/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, context: { params: { fileId: string } }) {
  try {
    await requireUser();
    if (!await isImportDrawingFile(context.params.fileId)) return NextResponse.json({ ok: false, error: '当前图纸资料已变化，请刷新重新选择' }, { status: 404 });
    return download(req, context);
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    console.error('import drawing download failed', error);
    return NextResponse.json({ ok: false, error: '资料下载失败，请重试' }, { status: 500 });
  }
}
