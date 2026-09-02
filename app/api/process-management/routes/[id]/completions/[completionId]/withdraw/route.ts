import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import {
  processCompletionWithdrawalWorkOrderWhere,
  resolveProcessCompletionWithdrawalScope,
} from '@/lib/process-completion-withdrawal-access';
import {
  previewProcessCompletionWithdrawal,
  ProcessCompletionWithdrawalError,
  withdrawProcessCompletion,
} from '@/lib/process-completion-withdrawal-service';
import { prisma } from '@/lib/prisma';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceError(error: ProcessCompletionWithdrawalError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

function canWithdraw(user: Awaited<ReturnType<typeof requireUser>>): boolean {
  return hasCapability(user.access, 'PRODUCTION', 'UPDATE');
}

async function assertWithdrawalTargetAllowed(
  user: Awaited<ReturnType<typeof requireUser>>,
  routeId: string,
  completionId: string,
): Promise<void> {
  const scope = resolveProcessCompletionWithdrawalScope(user);
  const allowed = await prisma.processCompletion.findFirst({
    where: {
      id: completionId,
      routeId,
      workOrder: processCompletionWithdrawalWorkOrderWhere(scope),
    },
    select: { id: true },
  });
  if (!allowed) {
    throw new ProcessCompletionWithdrawalError(
      '该报工不在本人可管理的生产范围内',
      403,
      'PROCESS_COMPLETION_WITHDRAWAL_SCOPE_FORBIDDEN',
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    const user = await requireUser();
    if (!canWithdraw(user)) return forbidden('仅管理员、生产主管或组长可预览完工撤回影响');
    await assertWithdrawalTargetAllowed(user, params.id, params.completionId);
    const data = await previewProcessCompletionWithdrawal(params.id, params.completionId);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ProcessCompletionWithdrawalError) return serviceError(error);
    console.error('process completion withdrawal preview failed', error);
    return NextResponse.json({ ok: false, error: '完工撤回影响预览失败' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; completionId: string } },
) {
  try {
    assertSameOriginMutationRequest(req);
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json(
        { ok: false, error: '请求格式错误', code: 'PROCESS_COMPLETION_WITHDRAWAL_JSON_REQUIRED' },
        { status: 415 },
      );
    }
    const user = await requireUser({ write: 'production' });
    if (!canWithdraw(user)) return forbidden('仅管理员、生产主管或组长可执行完工撤回');
    await assertWithdrawalTargetAllowed(user, params.id, params.completionId);
    const body = await req.json().catch(() => ({})) as {
      expectedRouteVersion?: unknown;
      category?: unknown;
      idempotencyKey?: unknown;
    };
    const data = await withdrawProcessCompletion({
      routeId: params.id,
      completionId: params.completionId,
      expectedRouteVersion: body.expectedRouteVersion,
      category: body.category,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
      actor: user.displayName || user.username,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ProcessCompletionWithdrawalError) return serviceError(error);
    console.error('process completion withdrawal failed', error);
    return NextResponse.json({ ok: false, error: '完工撤回失败' }, { status: 500 });
  }
}
