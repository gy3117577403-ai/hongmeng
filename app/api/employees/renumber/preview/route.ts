import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  EmployeeNumberReorderError,
  previewEmployeeNumberReorder,
} from '@/lib/employee-number-reorder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const preview = await previewEmployeeNumberReorder(body.items);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeNumberReorderError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('employee number reorder preview failed', error);
    return NextResponse.json({ ok: false, error: '员工编号重排预览失败' }, { status: 500 });
  }
}
