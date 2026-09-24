import { NextRequest, NextResponse } from 'next/server';
import { requireEmployeeAccountAuthorizer, ForbiddenError, UnauthorizedError, forbidden, unauthorized } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { saveModuleAccount } from '@/lib/module-account-admin';
import { AccessGrantInputError } from '@/lib/user-access-admin';
import { Prisma } from '@prisma/client';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = await requireEmployeeAccountAuthorizer();
    const body = await request.json();
    const user = await saveModuleAccount(actor, body);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden();
    if (error instanceof AccessGrantInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ ok: false, error: '该员工或账号已开通，请刷新列表后编辑已有账号' }, { status: 409 });
    console.error('module account save failed', error);
    return NextResponse.json({ ok: false, error: '保存失败，配置未变更，请重试' }, { status: 500 });
  }
}
