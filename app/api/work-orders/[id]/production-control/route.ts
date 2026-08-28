import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError, ForbiddenError, forbidden } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';
import { ProductionControlError } from '@/lib/production-control';
import { getProductionControl, mutateProductionControl, type ProductionControlCommand } from '@/lib/production-control-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof ProductionControlError || error instanceof ProductionAccessScopeError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  console.error('production-control', error);
  return NextResponse.json({ ok: false, error: '生产控制操作失败，请刷新后重试' }, { status: 500 });
}
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ ok: true, control: await getProductionControl(await requireUser(), params.id) }); }
  catch (error) { return failure(error); }
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const input = await req.json() as ProductionControlCommand;
    return NextResponse.json({ ok: true, control: await mutateProductionControl(user, params.id, input) });
  } catch (error) { return failure(error); }
}
