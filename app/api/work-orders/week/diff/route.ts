import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadWeeklyPlanDiff, type WeeklyPlanDiffItem, type WeeklyPlanDiffType } from '@/lib/weekly-plan-diff';
import { parseWeek } from '@/lib/weekly-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedTypes = new Set<WeeklyPlanDiffType>(['new', 'continued', 'changed', 'removed', 'duplicate', 'invalid']);

function matchesKeyword(item: WeeklyPlanDiffItem, keyword: string) {
  if (!keyword) return true;
  const order = item.next || item.current;
  const values = [
    order?.code,
    order?.specification,
    order?.customerName,
    order?.productName,
    order?.sourceOrderNo,
    ...item.changes.flatMap(change => [change.label, change.before, change.after]),
    ...item.blockers.flatMap(issue => [issue.label, issue.message]),
    ...item.warnings.flatMap(issue => [issue.label, issue.message]),
  ];
  return values.some(value => String(value || '').toLocaleLowerCase().includes(keyword));
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const currentWeekStart = parseWeek(req.nextUrl.searchParams.get('currentWeekStart'));
    const nextWeekStart = parseWeek(req.nextUrl.searchParams.get('nextWeekStart'));
    const currentBatchId = req.nextUrl.searchParams.get('currentBatchId')?.trim() || null;
    const nextBatchId = req.nextUrl.searchParams.get('nextBatchId')?.trim() || null;
    const requestedType = req.nextUrl.searchParams.get('type') || 'all';
    const type = allowedTypes.has(requestedType as WeeklyPlanDiffType) ? requestedType as WeeklyPlanDiffType : 'all';
    const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim().toLocaleLowerCase();
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(500, Math.max(20, Number(req.nextUrl.searchParams.get('pageSize') || 80) || 80));

    const result = await loadWeeklyPlanDiff({ currentWeekStart, nextWeekStart, currentBatchId, nextBatchId });
    const filtered = result.items.filter(item => (type === 'all' || item.categories.includes(type)) && matchesKeyword(item, keyword));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const items = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

    return NextResponse.json({
      ok: true,
      data: {
        currentWeek: result.currentWeek,
        nextWeek: result.nextWeek,
        summary: result.summary,
        items,
        pagination: { page: safePage, pageSize, total, totalPages },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '周计划差异加载失败' }, { status: 500 });
  }
}
