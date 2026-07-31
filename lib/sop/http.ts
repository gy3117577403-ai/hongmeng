import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorized } from '@/lib/auth';
import { SopRequestError } from '@/lib/sop';

export function sopRouteError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof SopRequestError) {
    return NextResponse.json({
      ok: false,
      error: error.message,
      message: error.message,
      code: error.code,
      detail: error.detail,
    }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ ok: false, error: fallback, message: fallback }, { status: 500 });
}
