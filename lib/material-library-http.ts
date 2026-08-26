import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { MaterialLibraryError } from '@/lib/material-library';

export function materialLibraryRouteError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof MaterialLibraryError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ ok: false, error: '物料编码或二维码记录已存在，请刷新后重试' }, { status: 409 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return NextResponse.json({ ok: false, error: '物料数据刚被其他操作更新，请刷新后重试' }, { status: 409 });
  }
  console.error(`[material-library] ${fallback}`, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
