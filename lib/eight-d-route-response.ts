import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { EightDReportError } from '@/lib/eight-d-reports';

export function eightDRouteError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof EightDReportError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if ((error as { code?: string }).code === 'P2002') {
    return NextResponse.json({ ok: false, error: '报告编号或PDF内容已存在，请检查后重试', code: 'EIGHT_D_DUPLICATE' }, { status: 409 });
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
