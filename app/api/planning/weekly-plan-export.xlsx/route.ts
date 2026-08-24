import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import { logOp } from '@/lib/logs';
import {
  createWeeklyPlanExportWorkbook,
  loadWeeklyPlanExportData,
  parseWeeklyPlanExportRange,
  parseWeeklyPlanExportVersion,
  summarizeWeeklyPlanRows,
  weeklyPlanExportFileName,
  weeklyPlanRowsForRange,
  WeeklyPlanExportError,
} from '@/lib/weekly-plan-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const version = parseWeeklyPlanExportVersion(request.nextUrl.searchParams.get('version') || 'full');
    const range = parseWeeklyPlanExportRange(request.nextUrl.searchParams.get('range') || 'execution');
    const dataset = await loadWeeklyPlanExportData({ productionScope });
    const selectedRows = weeklyPlanRowsForRange(dataset, range);
    const selectedSummary = summarizeWeeklyPlanRows(selectedRows);
    const workbook = createWeeklyPlanExportWorkbook({ dataset, version, range });
    const buffer = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
    const filename = weeklyPlanExportFileName(dataset, version, range);
    await logOp({
      userId: user.id,
      action: 'export_weekly_production_plan',
      targetType: 'production_plan_week',
      targetId: dataset.weekStartDate,
      detail: {
        version,
        range,
        filename,
        weekStartDate: dataset.weekStartDate,
        weekEndDate: dataset.weekEndDate,
        batchCount: selectedSummary.batchCount,
        orderCount: selectedSummary.orderCount,
        quantity: selectedSummary.quantity,
        knownTotalHours: selectedSummary.totalHours,
        carryoverBatchCount: range === 'execution' ? dataset.summary.carryover.batchCount : 0,
        quantityMissingCount: selectedSummary.quantityMissingCount,
        hoursMissingCount: selectedSummary.hoursMissingCount,
      },
    });
    const responseBuffer = Buffer.from(buffer);
    const responseBody = responseBuffer.buffer.slice(
      responseBuffer.byteOffset,
      responseBuffer.byteOffset + responseBuffer.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WeeklyPlanExportError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('weekly plan export failed', error);
    return NextResponse.json({ ok: false, error: '本周生产计划导出失败' }, { status: 500 });
  }
}
