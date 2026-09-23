import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, ForbiddenError, unauthorized, forbidden } from '@/lib/auth';
import { listLibrary } from '@/lib/sample-library-query';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { await requireUser(); return NextResponse.json({ ok: true, ...await listLibrary(request.nextUrl.searchParams) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); if (error instanceof ForbiddenError) return forbidden(); console.error('sample library list', error); return NextResponse.json({ ok: false, error: '样品库加载失败，请重试' }, { status: 500 }); }
}
