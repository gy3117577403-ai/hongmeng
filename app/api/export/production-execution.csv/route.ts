import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  resolveProductionWeek,
} from '@/lib/production-execution';

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
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'));
    const data = await loadProductionExecution({
      week,
      filters: productionFiltersFromSearchParams(params),
      view: parseProductionExecutionView(params.get('view')),
      page: 1,
      pageSize: 5000,
    });
    const headers = ['规格', '客户', '品名', '状态', '优先级', '交期', '未交量', '完成数量', '图纸状态', '配料状态', '资料完整度', '最近进度', '最近更新时间'];
    const rows = data.items.map(item => [
      item.specification || item.code,
      item.customerName || '',
      item.productName || '',
      item.stageText,
      item.priority === 'urgent' ? '紧急' : item.priority === 'high' ? '高' : '一般',
      item.deliveryDay || item.plannedAt || '',
      item.uncompletedQty || '',
      item.completedQty || '',
      item.drawingStatus || '',
      item.materialStatus || '',
      item.documentCompleteness,
      item.latestProgressRemark || '',
      item.lastProgressAt || item.updatedAt,
    ]);
    const content = `\uFEFF${[headers, ...rows].map(row => row.map(csv).join(',')).join('\r\n')}`;
    await logOp({ userId: user.id, action: 'export_production_execution', targetType: 'work_order', detail: { count: rows.length } });
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="production-execution-${chinaDate()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('export production execution failed', error);
    return NextResponse.json({ ok: false, error: '生产执行导出失败' }, { status: 500 });
  }
}
