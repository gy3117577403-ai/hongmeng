import { NextResponse } from 'next/server';
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
  getProcessCompletionWithdrawalRequest,
  ProcessCompletionWithdrawalError,
} from '@/lib/process-completion-withdrawal-service';
import { ProductionAccessScopeError } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { requestId: string } },
) {
  try {
    const user = await requireUser();
    if (!hasCapability(user.access, 'PRODUCTION', 'UPDATE')) {
      return forbidden('仅管理员、生产主管或组长可查看报工撤回审批');
    }
    const scope = resolveProcessCompletionWithdrawalScope(user);
    const data = await getProcessCompletionWithdrawalRequest({
      requestId: params.requestId,
      workOrderWhere: processCompletionWithdrawalWorkOrderWhere(scope),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProcessCompletionWithdrawalError || error instanceof ProductionAccessScopeError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('process completion withdrawal request detail failed', error);
    return NextResponse.json(
      { ok: false, error: '撤回申请详情加载失败', code: 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_DETAIL_FAILED' },
      { status: 500 },
    );
  }
}
