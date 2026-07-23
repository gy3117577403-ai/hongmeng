import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  listProcessLaborPools,
  ProcessLaborServiceError,
} from '@/lib/process-labor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const result = await listProcessLaborPools({
      workDate: req.nextUrl.searchParams.get('workDate'),
      includeExhausted: req.nextUrl.searchParams.get('includeExhausted') === 'true',
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessLaborServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('process labor pools list failed', error);
    return NextResponse.json({ ok: false, error: '工时池加载失败' }, { status: 500 });
  }
}
