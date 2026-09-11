import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { samplePlanQuery, SampleQueryError } from '@/lib/sample-plan-query';
import { sampleWarning } from '@/lib/sample-plan-view';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = samplePlanQuery(req.nextUrl.searchParams, user.employeeId);
    const rows = await prisma.$queryRaw<Array<{ code: string; customer: string; model: string; issued: string | null; due: string | null; status: string; warningDays: number }>>(Prisma.sql`SELECT t.code, t.customer_name_snapshot AS customer, t.specification_snapshot AS model, to_char(t.issued_date,'YYYY-MM-DD') AS issued, to_char(t.due_date,'YYYY-MM-DD') AS due, t.status, t.warning_days AS "warningDays" FROM sample_tasks t WHERE ${q.base} AND (${q.views[q.view]}) ORDER BY ${q.order}`);
    const status: Record<string, string> = { PLANNED: '待开始', IN_PROGRESS: '采集中', SUBMITTED: '已提交', COMPLETED: '已完成', CANCELLED: '已取消' };
    const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
    const data = [['序号', '任务编号', '客户', '产品型号', '计划下达日期', '计划出货日期', '状态', '提前预警天数', '交期提示'], ...rows.map((r,i) => [i+1, r.code, r.customer, r.model, r.issued || '未记录', r.due, status[r.status] || r.status, r.warningDays, sampleWarning({ status: r.status, dueDate: r.due, warningDays: r.warningDays }).label])];
    return new NextResponse('\uFEFF' + data.map(row => row.map(cell).join(',')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sample-plans.csv"; filename*=UTF-8''${encodeURIComponent('样品计划清单.csv')}`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SampleQueryError) return NextResponse.json({ ok:false, error:error.message }, { status:400 });
    console.error('sample export failed', error); return NextResponse.json({ ok:false, error:'样品清单导出失败' }, { status:500 });
  }
}
