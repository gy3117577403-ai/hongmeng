import { moduleReadOnly } from '@/lib/module-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized, forbidden } from '@/lib/auth';
import { MaterialInputError } from '@/lib/material-source';
import { readMaterialOrder, mutateMaterialOrder } from '@/lib/material-order-service';
export const dynamic = 'force-dynamic';
const failure = (e: unknown) => {
  if (e instanceof UnauthorizedError) return unauthorized();
  if (e instanceof MaterialInputError) return NextResponse.json({ ok: false, error: e.message }, { status: e.statusCode });
  console.error('material order operation', e);
  return NextResponse.json({ ok: false, error: '操作失败，内容已保留，请重试' }, { status: 500 });
};
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireUser(); return NextResponse.json({ ok: true, order: await readMaterialOrder(params.id) }); } catch (e) { return failure(e); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(), canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE');
    if (moduleReadOnly(user.access, 'warehouse') || (!canConfirm && !user.access.capabilities.includes('PROCUREMENT:UPDATE'))) return forbidden();
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MaterialInputError('提交内容不正确');
    return NextResponse.json({ ok: true, order: await mutateMaterialOrder(params.id, body, user.id, canConfirm) });
  } catch (e) { return failure(e); }
}
