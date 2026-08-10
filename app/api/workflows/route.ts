import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadWorkflowCenter } from '@/lib/workflows';
import { parseWeek } from '@/lib/weekly-work-orders';
import type { WorkflowEntityType, WorkflowProcessStatus, WorkflowWeekScope } from '@/types';
import { chinaWeekRange } from '@/lib/production-planning';
import { reconcileCurrentProductionCarryovers } from '@/lib/production-carryovers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const entityTypes: Array<WorkflowEntityType | 'all'> = ['all', 'issue', 'change', 'production'];
const processStatuses: Array<WorkflowProcessStatus | 'all'> = ['all', 'waiting', 'processing', 'verifying', 'closed'];
const weekScopes: WorkflowWeekScope[] = ['history', 'current', 'next', 'afterNext'];

function workflowWeekScope(value: string | null): WorkflowWeekScope {
  if (value === 'history' || value === 'current' || value === 'next' || value === 'afterNext') return value;
  // Keep old deep links usable without exposing the retired scopes in the UI.
  if (value === 'carryover') return 'history';
  return 'current';
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.laborRole === 'EMPLOYEE') return forbidden('员工账号请在报表中心领取本人今日工时');
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const entityType = String(params.get('entityType') || 'production') as WorkflowEntityType | 'all';
    const status = String(params.get('status') || 'all') as WorkflowProcessStatus | 'all';
    const overdue = params.get('overdue') === 'true';
    const batchId = String(params.get('batchId') || '').trim().slice(0, 80);
    const workOrderId = String(params.get('workOrderId') || '').trim().slice(0, 80);
    const requestedWeekScope = params.get('weekScope');
    const weekScope = workflowWeekScope(requestedWeekScope);
    const weekStartDate = String(params.get('weekStart') || '').trim().slice(0, 10);

    if (!entityTypes.includes(entityType)) {
      return NextResponse.json({ ok: false, error: '流程类型筛选不正确' }, { status: 400 });
    }
    if (!processStatuses.includes(status)) {
      return NextResponse.json({ ok: false, error: '流程状态筛选不正确' }, { status: 400 });
    }
    if (
      requestedWeekScope
      && requestedWeekScope !== 'all'
      && requestedWeekScope !== 'carryover'
      && !weekScopes.includes(requestedWeekScope as WorkflowWeekScope)
    ) {
      return NextResponse.json({ ok: false, error: '生产周范围筛选不正确' }, { status: 400 });
    }
    if (weekStartDate && !parseWeek(weekStartDate)) {
      return NextResponse.json({ ok: false, error: '历史生产周日期格式不正确' }, { status: 400 });
    }

    if (weekScope === 'current') {
      await reconcileCurrentProductionCarryovers({ targetWeekStart: chinaWeekRange(new Date()).start, actorId: user.id });
    }

    const result = await loadWorkflowCenter({
      keyword,
      entityType,
      status,
      overdue,
      batchId,
      workOrderId,
      weekScope,
      weekStartDate: weekScope === 'history' ? weekStartDate : '',
      laborEmployeeTeam: user.laborRole === 'TEAM_LEAD'
        ? String(user.employee?.team || '__UNBOUND_TEAM_LEAD__').trim()
        : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('workflow center load failed', error);
    return NextResponse.json({ ok: false, error: '流程中心加载失败' }, { status: 500 });
  }
}
