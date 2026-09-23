import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, ForbiddenError, unauthorized, forbidden } from '@/lib/auth';
import { libraryDetail, librarySource } from '@/lib/sample-library-query';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const source = request.nextUrl.searchParams.get('source');
    const data = source ? await librarySource(params.id, source) : await libraryDetail(params.id);
    return NextResponse.json(data ? { ok: true, ...data } : { ok: false, error: '该样品资料不存在或已移除' }, { status: data ? 200 : 404, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); if (error instanceof ForbiddenError) return forbidden(); console.error('sample library detail', error); return NextResponse.json({ ok: false, error: '样品资料加载失败，请重试' }, { status: 500 }); }
}
