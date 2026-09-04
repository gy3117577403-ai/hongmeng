import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  productionWeekSelector,
  resolveProductionWeek,
} from '@/lib/production-execution';
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

function csv(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function chinaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const params = req.nextUrl.searchParams;
    const weekInput = [params.get('weekStart'), params.get('weekEnd'), params.get('scope')] as const;
    const weekSelector = productionWeekSelector(...weekInput);
    const selected = new Set(params.getAll('selectedWorkOrderId').flatMap(value => value.split(',')).filter(Boolean));
    const filters = productionFiltersFromSearchParams(params);
    const view = parseProductionExecutionView(params.get('view'));
    const readResult = await productionReadCoordinator.run({
      requestId,
      operation: 'execution_csv',
      // Bulk output is deliberately never joined or cached. It still occupies
      // the same global production-read slot until formatting is complete.
      key: productionReadKey('execution_csv', productionScope, { requestId, weekSelector }),
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
      const headers = ['序号', '工单号', '规格', '客户', '品名', '状态', '优先级', '客户交期', '未交量', '完成数量', '图纸状态', '配料状态', '资料完整度', '最近进度', '最近更新时间', '当前问题备注', '暂停原因', '内部预计完成', '原客户承诺', '原计划基准'];
      const rows = data.items.filter(item => !selected.size || selected.has(item.id)).map((item, index) => [
        index + 1,
        item.businessCode || item.code,
        item.specification || item.code,
        item.customerName || '',
        item.productName || '',
        item.productionControl?.pausedAt ? '已暂停' : item.stageText,
        item.priority === 'urgent' ? '紧急' : item.priority === 'high' ? '高' : '一般',
        item.productionControl?.customerDueDate || '客户交期待确认',
        item.uncompletedQty || '',
        item.completedQty || '',
        item.drawingStatus || '',
        item.materialStatus || '',
        item.documentCompleteness,
        item.latestProgressRemark || '',
        item.lastProgressAt || item.updatedAt,
        item.productionControl?.note?.text || '',
        item.productionControl?.pause?.reason || '',
        item.productionControl?.estimatedCompletionDate || '',
        item.productionControl?.deliveryBaselineDate || '',
        item.productionControl?.planBaselineDate || '',
      ]);
      return {
        content: `\uFEFF${[headers, ...rows].map(row => row.map(csv).join(',')).join('\r\n')}`,
        count: rows.length,
      };
    });
    if (!readResult.started) {
      const response = NextResponse.json({
        ok: false,
        error: '生产执行导出繁忙，请稍后重试',
        code: 'PRODUCTION_EXECUTION_EXPORT_BUSY',
        requestId,
        retryAfterSeconds: 2,
      }, { status: 503 });
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Retry-After', '2');
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    await logOp({ userId: user.id, action: 'export_production_execution', targetType: 'work_order', detail: { count: readResult.value.count } });
    const response = new NextResponse(readResult.value.content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="production-execution-${chinaDate()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('export production execution failed', error);
    return NextResponse.json({ ok: false, error: '生产执行导出失败', requestId }, { status: 500 });
  }
}
