import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { populateBusinessReportWorkbook } from '@/lib/business-excel';
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

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function chinaDateKey(value: Date | null): string {
  return value?.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) || '未建立周计划';
}

function chinaDateTime(value = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value).replaceAll('/', '-');
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
    const workbook = new ExcelJS.Workbook();
    const plannedQty = rows.reduce((sum, row) => sum + finiteNumber(row.plannedQty), 0);
    const completedQty = rows.reduce((sum, row) => sum + finiteNumber(row.completedQty), 0);
    const remainingQty = rows.reduce((sum, row) => sum + finiteNumber(row.remainingQty), 0);
    const uniqueOrders = new Set(rows.map(row => row.workOrderId).filter(Boolean)).size;
    const completionRate = plannedQty > 0 ? completedQty / plannedQty : 0;
    const period = `${chinaDateKey(week.weekStart)} 至 ${chinaDateKey(week.weekEnd)}`;
    populateBusinessReportWorkbook(workbook, {
      title: '生产调度排班表',
      subtitle: '工单、工序、人员与数量执行快照',
      sheetName: '生产调度排班',
      period,
      scope: selectedIds(request).length ? `已选 ${uniqueOrders} 单` : `当前筛选 · ${uniqueOrders} 单`,
      generatedAt: chinaDateTime(),
      method: '数据来自当前生产执行筛选结果；计划、已报与剩余数量按排班记录汇总，同一工单存在多条排班时分别展示。',
      kpis: [
        { icon: '▣', label: '工单数量', value: uniqueOrders, unit: '单', note: `${rows.length} 条排班记录`, tone: 'orange' },
        { icon: '✓', label: '已报数量', value: completedQty.toLocaleString('zh-CN'), note: `计划 ${plannedQty.toLocaleString('zh-CN')}`, tone: 'green' },
        { icon: '↗', label: '完成率', value: `${(completionRate * 100).toFixed(1)}%`, note: '已报数量 ÷ 计划数量', tone: 'blue' },
        { icon: '!', label: '剩余数量', value: remainingQty.toLocaleString('zh-CN'), note: '待排产或待报工数量', tone: remainingQty > 0 ? 'red' : 'green' },
      ],
      headers: [
        '规格', '客户', '品名', '生产状态', '优先级', '交期', '工单数量', '生产日期', '班次', '班组',
        '排班状态', '工序范围', '计划数量', '已报数量', '剩余数量', '安排人员', '人员分配', '计划工时(小时)',
      ],
      rows: rows.map(row => [
        row.specification,
        row.customer,
        row.productName,
        row.productionStatus,
        row.priority,
        row.deliveryDate,
        row.targetQty,
        row.workDate,
        row.shift,
        row.team,
        row.arrangementStatus,
        row.processes,
        row.plannedQty,
        row.completedQty,
        row.remainingQty,
        row.employees,
        row.employeeQuantities,
        row.plannedHours,
      ]),
    });
    const buffer = await workbook.xlsx.writeBuffer();
    await logOp({
      userId: user.id,
      action: 'export_production_dispatch',
      targetType: 'work_order',
      detail: { count: rows.length, workOrderCount: uniqueOrders, sheetCount: 1, period },
    });
    const responseBuffer = Buffer.from(buffer);
    const responseBody = responseBuffer.buffer.slice(
      responseBuffer.byteOffset,
      responseBuffer.byteOffset + responseBuffer.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(responseBody, {
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
