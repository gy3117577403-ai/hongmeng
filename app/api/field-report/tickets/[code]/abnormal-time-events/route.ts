import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  createFieldAbnormalTimeEvent,
  fieldAbnormalTimeErrorResponse,
} from '@/lib/field-abnormal-time-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await createFieldAbnormalTimeEvent({
      code: params.code,
      userId: user.id,
      employeeId: user.employeeId,
      body,
    });
    return NextResponse.json({ ok: true, data: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const known = fieldAbnormalTimeErrorResponse(error);
    if (known) {
      return NextResponse.json({ ok: false, error: known.message, code: known.code }, { status: known.status });
    }
    console.error('field abnormal time create failed', error);
    return NextResponse.json({ ok: false, error: '异常工时登记失败，请稍后重试' }, { status: 500 });
  }
}
