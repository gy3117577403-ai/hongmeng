import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { InternalQualityRiskError } from '@/lib/internal-quality-risks';
import { PrintableDocumentError } from '@/lib/printable-document';

export function internalQualityRiskRouteError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof InternalQualityRiskError || error instanceof PrintableDocumentError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if ((error as { code?: string }).code === 'P2002') {
    return NextResponse.json({ ok: false, error: '异常汇总编号或关联记录已存在，请检查后重试', code: 'QUALITY_RISK_DUPLICATE' }, { status: 409 });
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
