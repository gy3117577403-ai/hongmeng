import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse } from '@/lib/data-tools';
import { loadWeeklyPlanDiff } from '@/lib/weekly-plan-diff';
import { parseWeek } from '@/lib/weekly-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const typeText = {
  new: '新增',
  continued: '延续',
  changed: '变更',
  removed: '下周取消',
  duplicate: '重复',
  invalid: '异常',
};

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const result = await loadWeeklyPlanDiff({
      currentWeekStart: parseWeek(req.nextUrl.searchParams.get('currentWeekStart')),
      nextWeekStart: parseWeek(req.nextUrl.searchParams.get('nextWeekStart')),
      currentBatchId: req.nextUrl.searchParams.get('currentBatchId')?.trim() || null,
      nextBatchId: req.nextUrl.searchParams.get('nextBatchId')?.trim() || null,
    });
    const rows: unknown[][] = [[
      '差异类型',
      '规格',
      '客户',
      '品名',
      '当前未交量',
      '下周未交量',
      '当前交期',
      '下周交期',
      '当前图纸状态',
      '下周图纸状态',
      '当前配料状态',
      '下周配料状态',
      '资料完整度',
      '异常信息',
    ]];
    for (const item of result.items) {
      const current = item.current;
      const next = item.next;
      const display = next || current;
      rows.push([
        item.categories.map(type => typeText[type]).join(' / '),
        display?.specification || display?.code || '',
        display?.customerName || '',
        display?.productName || '',
        current?.uncompletedQty || '',
        next?.uncompletedQty || '',
        current?.deliveryDay || current?.plannedAt || '',
        next?.deliveryDay || next?.plannedAt || '',
        current?.drawingStatus || '',
        next?.drawingStatus || '',
        current?.materialStatus || '',
        next?.materialStatus || '',
        display?.drawingLibraryCompleteness || '0/5',
        [...item.blockers, ...item.warnings].map(issue => issue.message).join('；'),
      ]);
    }
    const currentStart = result.currentWeek.weekStartDate || 'unknown';
    const nextStart = result.nextWeek.weekStartDate || 'unknown';
    return csvResponse(`weekly-plan-diff-${currentStart}-to-${nextStart}.csv`, csv(rows));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '周计划差异导出失败' }, { status: 500 });
  }
}
