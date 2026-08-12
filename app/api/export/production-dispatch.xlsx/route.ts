import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  resolveProductionWeek,
} from '@/lib/production-execution';
import { buildProductionDispatchDocumentRows } from '@/lib/production-dispatch-document';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function selectedIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll('selectedWorkOrderId')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const params = request.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const data = await loadProductionExecution({
      week,
      filters: productionFiltersFromSearchParams(params),
      view: parseProductionExecutionView(params.get('view')),
      page: 1,
      pageSize: 5000,
      productionScope,
    });
    const rows = buildProductionDispatchDocumentRows(data.items, selectedIds(request));
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows.map(row => ({
      规格: row.specification,
      客户: row.customer,
      品名: row.productName,
      生产状态: row.productionStatus,
      优先级: row.priority,
      交期: row.deliveryDate,
      工单数量: row.targetQty,
      生产日期: row.workDate,
      班次: row.shift,
      班组: row.team,
      排班状态: row.arrangementStatus,
      工序范围: row.processes,
      计划数量: row.plannedQty,
      已报数量: row.completedQty,
      剩余数量: row.remainingQty,
      安排人员: row.employees,
      人员分配: row.employeeQuantities,
      计划工时小时: row.plannedHours,
    })));
    sheet['!freeze'] = { xSplit: 1, ySplit: 1 };
    sheet['!cols'] = [
      { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 9 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 11 }, { wch: 28 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, '生产调度排班');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await logOp({ userId: user.id, action: 'export_production_dispatch', targetType: 'work_order', detail: { count: rows.length } });
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('生产调度排班.xlsx')}`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production dispatch export failed', error);
    return NextResponse.json({ ok: false, error: '生产调度排班导出失败' }, { status: 500 });
  }
}
