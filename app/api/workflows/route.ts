import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadWorkflowCenter } from '@/lib/workflows';
import type { WorkflowEntityType, WorkflowProcessStatus, WorkflowWeekScope } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const entityTypes: Array<WorkflowEntityType | 'all'> = ['all', 'issue', 'change', 'production'];
const processStatuses: Array<WorkflowProcessStatus | 'all'> = ['all', 'waiting', 'processing', 'verifying', 'closed'];
const weekScopes: WorkflowWeekScope[] = ['all', 'carryover', 'current', 'next', 'history'];

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const keyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const entityType = String(params.get('entityType') || 'all') as WorkflowEntityType | 'all';
    const status = String(params.get('status') || 'all') as WorkflowProcessStatus | 'all';
    const overdue = params.get('overdue') === 'true';
    const batchId = String(params.get('batchId') || '').trim().slice(0, 80);
    const workOrderId = String(params.get('workOrderId') || '').trim().slice(0, 80);
    const weekScope = String(params.get('weekScope') || 'all') as WorkflowWeekScope;

    if (!entityTypes.includes(entityType)) {
      return NextResponse.json({ ok: false, error: '流程类型筛选不正确' }, { status: 400 });
    }
    if (!processStatuses.includes(status)) {
      return NextResponse.json({ ok: false, error: '流程状态筛选不正确' }, { status: 400 });
    }
    if (!weekScopes.includes(weekScope)) {
      return NextResponse.json({ ok: false, error: '生产周范围筛选不正确' }, { status: 400 });
    }

    const result = await loadWorkflowCenter({ keyword, entityType, status, overdue, batchId, workOrderId, weekScope });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('workflow center load failed', error);
    return NextResponse.json({ ok: false, error: '流程中心加载失败' }, { status: 500 });
  }
}
