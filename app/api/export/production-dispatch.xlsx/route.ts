import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { populateBusinessReportWorkbook } from '@/lib/business-excel';
import { logOp } from '@/lib/logs';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  productionWeekSelector,
  resolveProductionWeek,
} from '@/lib/production-execution';
import { buildProductionDispatchDocumentRows } from '@/lib/production-dispatch-document';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import {
  productionReadCoordinator,
  productionReadKey,
} from '@/lib/production-read-coordinator';

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
  const requestId = randomUUID();
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const params = request.nextUrl.searchParams;
    const weekInput = [params.get('weekStart'), params.get('weekEnd'), params.get('scope')] as const;
    const weekSelector = productionWeekSelector(...weekInput);
    const filters = productionFiltersFromSearchParams(params);
    const view = parseProductionExecutionView(params.get('view'));
    const selection = selectedIds(request);
    const readResult = await productionReadCoordinator.run({
      requestId,
      operation: 'dispatch_xlsx',
      key: productionReadKey('dispatch_xlsx', productionScope, { requestId, weekSelector }),
    }, async () => {
      const week = await resolveProductionWeek(...weekInput);
      const data = await loadProductionExecution({
        week,
        filters,
        view,
        page: 1,
        pageSize: 5000,
        productionScope,
      });
      const rows = buildProductionDispatchDocumentRows(data.items, selection);
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
        scope: selection.length ? `已选 ${uniqueOrders} 单` : `当前筛选 · ${uniqueOrders} 单`,
        generatedAt: chinaDateTime(),
        method: '数据来自当前生产执行筛选结果；计划、已报与剩余数量按排班记录汇总，同一工单存在多条排班时分别展示。',
        kpis: [
          { icon: '▣', label: '工单数量', value: uniqueOrders, unit: '单', note: `${rows.length} 条排班记录`, tone: 'orange' },
          { icon: '✓', label: '已报数量', value: completedQty.toLocaleString('zh-CN'), note: `计划 ${plannedQty.toLocaleString('zh-CN')}`, tone: 'green' },
          { icon: '↗', label: '完成率', value: `${(completionRate * 100).toFixed(1)}%`, note: '已报数量 ÷ 计划数量', tone: 'blue' },
          { icon: '!', label: '剩余数量', value: remainingQty.toLocaleString('zh-CN'), note: '待排产或待报工数量', tone: remainingQty > 0 ? 'red' : 'green' },
        ],
        headers: [
          '序号',
          '规格', '客户', '品名', '生产状态', '优先级', '客户交期', '工单数量', '生产日期', '班次', '班组',
          '排班状态', '工序范围', '计划数量', '已报数量', '剩余数量', '安排人员', '人员分配', '计划工时(小时)',
          '内部预计完成', '历史基准', '当前问题备注', '暂停原因', '工单标识',
        ],
        rows: rows.map((row, index) => [
          index + 1,
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
          row.estimatedDate, row.baselineDates, row.note, row.pauseReason, row.workOrderId,
        ]),
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const responseBuffer = Buffer.from(buffer);
      return {
        body: responseBuffer.buffer.slice(
          responseBuffer.byteOffset,
          responseBuffer.byteOffset + responseBuffer.byteLength,
        ) as ArrayBuffer,
        count: rows.length,
        workOrderCount: uniqueOrders,
        period,
      };
    });
    if (!readResult.started) {
      const response = NextResponse.json({
        ok: false,
        error: '生产调度排班导出繁忙，请稍后重试',
        code: 'PRODUCTION_DISPATCH_EXPORT_BUSY',
        requestId,
        retryAfterSeconds: 2,
      }, { status: 503 });
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Retry-After', '2');
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    await logOp({
      userId: user.id,
      action: 'export_production_dispatch',
      targetType: 'work_order',
      detail: {
        count: readResult.value.count,
        workOrderCount: readResult.value.workOrderCount,
        sheetCount: 1,
        period: readResult.value.period,
      },
    });
    const response = new NextResponse(readResult.value.body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('生产调度排班.xlsx')}`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production dispatch export failed', error);
    return NextResponse.json({ ok: false, error: '生产调度排班导出失败', requestId }, { status: 500 });
  }
}
