import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import { reconcileCurrentProductionCarryovers } from '@/lib/production-carryovers';
import { naturalProductionWeek } from '@/lib/production-execution';
import {
  loadWeeklyPlanExportData,
  parseWeeklyPlanExportMode,
  WeeklyPlanExportError,
} from '@/lib/weekly-plan-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const mode = parseWeeklyPlanExportMode(typeof body.mode === 'string' ? body.mode : null);
    const startDate = typeof body.startDate === 'string' ? body.startDate : undefined;
    const endDate = typeof body.endDate === 'string' ? body.endDate : undefined;
    if (mode === 'week_execution' && productionScope.canReconcile) {
      const week = naturalProductionWeek();
      await reconcileCurrentProductionCarryovers({ targetWeekStart: week.start, actorId: user.id });
    }
    const data = await loadWeeklyPlanExportData({ productionScope, mode, startDate, endDate });
    return NextResponse.json({
      ok: true,
      preview: {
        weekStartDate: data.weekStartDate,
        weekEndDate: data.weekEndDate,
        mode: data.mode,
        digest: data.digest,
        summary: data.summary,
      },
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WeeklyPlanExportError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('weekly plan export preview failed', error);
    return NextResponse.json({ ok: false, error: '计划导出预览生成失败' }, { status: 500 });
  }
}
