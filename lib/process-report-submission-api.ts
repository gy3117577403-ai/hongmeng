import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { ProcessCompletionServiceError } from '@/lib/process-completion-service';
export function reportingRecoveryErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof ProcessCompletionServiceError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  console.error('reporting recovery failed', error);
  return NextResponse.json({ ok: false, error: '报工待处理操作未完成，请刷新后重试', code: 'PROCESS_SUBMISSION_FAILED' }, { status: 500 });
}
