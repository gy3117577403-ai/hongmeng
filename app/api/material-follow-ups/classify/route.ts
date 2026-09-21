import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError, forbidden } from '@/lib/auth';
import { classifyMaterialFollowUps } from '@/lib/material-exception-service';
import { MaterialInputError } from '@/lib/material-source';
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.access.capabilities.includes('PROCUREMENT:UPDATE')) return forbidden();
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MaterialInputError('提交内容不正确');
    const count = await classifyMaterialFollowUps(body.items, body.supplySource, user.id);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof MaterialInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    return NextResponse.json({ ok: false, error: '批量分类失败，请刷新后重试' }, { status: 500 });
  }
}
