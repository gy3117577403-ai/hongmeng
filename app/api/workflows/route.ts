import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadWorkflowCenter } from '@/lib/workflows';
import { parseWeek } from '@/lib/weekly-work-orders';
import type { WorkflowEntityType, WorkflowProcessStatus, WorkflowWeekScope } from '@/types';
import { chinaWeekRange } from '@/lib/production-planning';
import { reconcileCurrentProductionCarryovers } from '@/lib/production-carryovers';
import { hasCapability } from '@/lib/department-access';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

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
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const entityType = String(params.get('entityType') || 'all') as WorkflowEntityType | 'all';
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
    const productionScope = resolveProductionEntityScope(user);
    const canViewProduction = hasCapability(user.access, 'PRODUCTION', 'READ')
      || hasCapability(user.access, 'PLANNING', 'READ');
    const canViewIssues = hasCapability(user.access, 'QUALITY', 'READ')
      || hasCapability(user.access, 'ISSUE_MANAGEMENT', 'READ');
    const canViewChanges = hasCapability(user.access, 'ENGINEERING', 'READ')
      || hasCapability(user.access, 'QUALITY', 'READ')
      || hasCapability(user.access, 'CHANGE_MANAGEMENT', 'READ');
    if (entityType === 'issue' && !canViewIssues) {
      return forbidden('当前账号没有查看问题流程的权限');
    }
    if (entityType === 'change' && !canViewChanges) {
      return forbidden('当前账号没有查看变更流程的权限');
    }
    if (entityType === 'production') {
      if (!canViewProduction) return forbidden('当前账号没有查看生产流程的权限');
      assertProductionScopeRead(productionScope);
    }

    const allowedEntityTypes: WorkflowEntityType[] = [
      ...(canViewIssues ? ['issue' as const] : []),
      ...(canViewChanges ? ['change' as const] : []),
      ...(canViewProduction ? ['production' as const] : []),
    ];
    if (entityType === 'all' && !allowedEntityTypes.length) {
      return forbidden('当前账号没有查看流程中心的权限');
    }
    if (entityType === 'all' && canViewProduction) assertProductionScopeRead(productionScope);

    if (canViewProduction && weekScope === 'current' && productionScope.canReconcile) {
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
      productionScope,
      allowedEntityTypes,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('workflow center load failed', error);
    return NextResponse.json({ ok: false, error: '流程中心加载失败' }, { status: 500 });
  }
}
