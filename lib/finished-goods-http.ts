import { NextResponse } from 'next/server';
import { ForbiddenError, forbidden, UnauthorizedError, unauthorized } from '@/lib/auth';
import { FinishedGoodsError } from '@/lib/finished-goods-domain';
export function fgErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden();
  if (error instanceof FinishedGoodsError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  console.error('[finished-goods]', error);
  return NextResponse.json({ ok: false, error: '成品仓操作失败，请刷新后重试' }, { status: 500 });
}
