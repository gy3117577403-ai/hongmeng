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
    const rows = await prisma.$queryRaw<Array<{ code: string; customer: string; model: string; issued: string | null; due: string | null; status: string; warningDays: number; taskType: string; week: string | null; plannedCompletion: string | null; quantity: number | null; completedQuantity: number }>>(Prisma.sql`SELECT to_char(t.planned_completion_date,'YYYY-MM-DD') AS "plannedCompletion", t.task_type AS "taskType", to_char(t.plan_week_start_date,'YYYY-MM-DD') AS week, t.sample_quantity AS quantity, t.completed_quantity AS "completedQuantity", t.code, t.customer_name_snapshot AS customer, t.specification_snapshot AS model, to_char(t.issued_date,'YYYY-MM-DD') AS issued, to_char(t.due_date,'YYYY-MM-DD') AS due, t.status, t.warning_days AS "warningDays" FROM sample_tasks t WHERE ${q.base} AND (${q.views[q.view]}) ORDER BY ${q.order}`);
    const status: Record<string, string> = { PLANNED: '待开始', IN_PROGRESS: '采集中', SUBMITTED: '已提交', COMPLETED: '已完成', CANCELLED: '已取消' };
    const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
    const data = [['序号', '任务编号', '客户', '产品型号', '样品类型', '计划周', '计划数量', '完成数量', '计划下达日期', '客户交期', '计划完成日期', '状态', '提前预警天数', '交期提示'], ...rows.map((r,i) => [i+1, r.code, r.customer, r.model, r.taskType === 'REPEAT' ? '老产品制作' : '新品试制', r.week || '待排期', r.quantity, r.completedQuantity, r.issued || '未记录', r.due, r.plannedCompletion, r.taskType === 'REPEAT' && r.status === 'IN_PROGRESS' ? '制作中' : status[r.status] || r.status, r.warningDays, sampleWarning({ status: r.status, dueDate: r.due, warningDays: r.warningDays }).label])];
    return new NextResponse('\uFEFF' + data.map(row => row.map(cell).join(',')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sample-plans.csv"; filename*=UTF-8''${encodeURIComponent('样品计划清单.csv')}`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SampleQueryError) return NextResponse.json({ ok:false, error:error.message }, { status:400 });
    console.error('sample export failed', error); return NextResponse.json({ ok:false, error:'样品清单导出失败' }, { status:500 });
  }
}
