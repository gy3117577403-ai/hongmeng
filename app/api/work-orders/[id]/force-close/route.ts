import { NextRequest, NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError, forbidden, requireUser, unauthorized } from '@/lib/auth';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';
import { ProductionControlError } from '@/lib/production-control';
import { closeProductionByException, previewProductionForceClose } from '@/lib/production-force-close-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden(error.message);
  if (error instanceof ProductionControlError || error instanceof ProductionAccessScopeError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  console.error('production force close', error);
  return NextResponse.json({ ok: false, error: '结单操作失败，请刷新后重试' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ ok: true, data: await previewProductionForceClose(await requireUser(), params.id) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(req);
    const actor = await requireUser();
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProductionControlError('请输入有效的结单信息');
    return NextResponse.json({ ok: true, data: await closeProductionByException(actor, params.id, input) });
  } catch (error) {
    return failure(error);
  }
}
