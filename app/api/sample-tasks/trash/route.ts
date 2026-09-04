import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, requireSystemAdministrator, unauthorized } from '@/lib/auth';
import { listDeletedSampleTasks } from '@/lib/sample-task-deletion';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSystemAdministrator();
    return NextResponse.json({ ok: true, items: await listDeletedSampleTasks() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '仅系统管理员可以查看样品回收站' }, { status: 403 });
    console.error('sample task trash failed', error);
    return NextResponse.json({ ok: false, error: '样品回收站读取失败' }, { status: 500 });
  }
}
