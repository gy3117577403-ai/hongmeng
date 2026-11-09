import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorized } from './auth';
import { MaterialLossError } from './material-loss-domain';
export function materialLossFailure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized(error);
  if (error instanceof MaterialLossError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
  console.error('material loss operation failed', error);
  return NextResponse.json({ ok: false, error: '操作未完成，请刷新核对后重试' }, { status: 500 });
}
