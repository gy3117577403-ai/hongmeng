import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  commitEmployeeNumberReorder,
  EmployeeNumberReorderError,
  listEmployeeNumberReorderBatches,
} from '@/lib/employee-number-reorder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, batches: await listEmployeeNumberReorderBatches() });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('employee number reorder history failed', error);
    return NextResponse.json({ ok: false, error: '员工编号重排记录加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await commitEmployeeNumberReorder({
      actorUserId: user.id,
      idempotencyKey: String(req.headers.get('Idempotency-Key') || ''),
      items: body.items,
      rosterFingerprint: body.rosterFingerprint,
      confirmationText: body.confirmationText,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeNumberReorderError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('employee number reorder commit failed', error);
    return NextResponse.json({ ok: false, error: '员工编号重排失败，事务已回滚' }, { status: 500 });
  }
}
