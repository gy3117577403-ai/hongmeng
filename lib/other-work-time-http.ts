import { NextResponse } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { OtherWorkError } from '@/lib/other-work-time-service';
import { Prisma } from '@prisma/client';

export function otherWorkErrorResponse(error: unknown) {
  if (error instanceof OtherWorkError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof UnauthorizedError) return NextResponse.json({ ok: false, error: '请登录并完成密码修改后重试' }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ ok: false, error: '没有操作权限' }, { status: 403 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) return NextResponse.json({ ok: false, error: '记录已变化或重复，请刷新重试' }, { status: 409 });
  console.error('other work time operation failed', error);
  return NextResponse.json({ ok: false, error: '操作失败，请稍后重试' }, { status: 500 });
}
export async function otherWorkJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new OtherWorkError('请求格式不正确'); }
}
