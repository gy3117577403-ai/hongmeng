import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadIssueWorkOrderOptions } from '@/lib/issue-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function integer(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const data = await loadIssueWorkOrderOptions({
      keyword: params.get('keyword') || '',
      page: integer(params.get('page'), 1, 100_000),
      pageSize: integer(params.get('pageSize'), 50, 100),
      selectedId: params.get('selectedId') || '',
      selectedOnly: params.get('selectedOnly') === 'true',
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue work order options failed', error);
    return NextResponse.json({ ok: false, error: '关联工单加载失败' }, { status: 500 });
  }
}
