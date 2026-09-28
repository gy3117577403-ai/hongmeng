import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorized, requireUser } from '@/lib/auth';
import { hasCapability, type AccessActionCode } from '@/lib/department-access';
import { ToolingError } from '@/lib/tooling-worklog-service';
export async function requireTooling(action: AccessActionCode = 'READ') {
  const user = await requireUser();
  if (!hasCapability(user.access, 'TERMINAL_TOOLING', action)) throw new UnauthorizedError('当前账号尚未开通端子调模的此项权限', 403);
  return user;
}
export function toolingFailure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized(error);
  if (error instanceof ToolingError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  console.error('Tooling operation failed', error);
  return NextResponse.json({ ok: false, error: '操作未完成，请重试；重复提交不会重复计入' }, { status: 500 });
}
