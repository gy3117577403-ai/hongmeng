import { NextRequest, NextResponse } from 'next/server';
import {
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
  listProcessCompletionWithdrawalRequests,
  ProcessCompletionWithdrawalError,
} from '@/lib/process-completion-withdrawal-service';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceError(error: ProcessCompletionWithdrawalError | ProductionAccessScopeError) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!hasCapability(user.access, 'PRODUCTION', 'UPDATE')) {
      return forbidden('仅管理员、生产主管或组长可查看报工撤回审批');
    }
    const scope = resolveProcessCompletionWithdrawalScope(user);
    const params = req.nextUrl.searchParams;
    const data = await listProcessCompletionWithdrawalRequests({
      status: params.get('status') || 'PENDING',
      take: params.get('take'),
      cursor: params.get('cursor'),
      routeId: params.get('routeId'),
      workOrderWhere: processCompletionWithdrawalWorkOrderWhere(scope),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionWithdrawalError || error instanceof ProductionAccessScopeError) {
      return serviceError(error);
    }
    console.error('process completion withdrawal request queue failed', error);
    return NextResponse.json(
      { ok: false, error: '撤回审批队列加载失败', code: 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_LIST_FAILED' },
      { status: 500 },
    );
  }
}
