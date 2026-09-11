import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { chinaDateKey } from './china-date';
import { SAMPLE_VIEWS, type SamplePlanView } from './sample-plan-view';
import { parseOptionalSampleDate, sampleTaskInclude, serializeSampleTask } from './sample-team';

export class SampleQueryError extends Error {}
export function samplePlanQuery(params: URLSearchParams, employeeId?: string | null, today = chinaDateKey(new Date())) {
  const view = (params.get('view') || params.get('status') || 'UNFINISHED') as SamplePlanView;
  if (!SAMPLE_VIEWS.includes(view)) throw new SampleQueryError('样品状态筛选无效');
  const unfinished = Prisma.sql`t.status NOT IN ('COMPLETED', 'CANCELLED')`;
  const pending = Prisma.sql`${unfinished} AND EXISTS (SELECT 1 FROM sample_submissions s WHERE s.id=t.active_submission_id AND s.status='PENDING')`;
  const views: Record<SamplePlanView, Prisma.Sql> = {
    UNFINISHED: unfinished, ALL: Prisma.sql`TRUE`,
    TODAY: Prisma.sql`${unfinished} AND t.due_date=${today}::date`,
    SOON: Prisma.sql`${unfinished} AND t.due_date>${today}::date AND t.due_date<=${today}::date+t.warning_days`,
    OVERDUE: Prisma.sql`${unfinished} AND t.due_date<${today}::date`,
    PLANNED: Prisma.sql`t.status='PLANNED'`, IN_PROGRESS: Prisma.sql`t.status='IN_PROGRESS'`,
    PENDING_REVIEW: pending, COMPLETED: Prisma.sql`t.status='COMPLETED'`, CANCELLED: Prisma.sql`t.status='CANCELLED'`,
  };
  const filters: Prisma.Sql[] = [Prisma.sql`t.deleted_at IS NULL`];
  const keyword = params.get('keyword')?.trim().slice(0, 100);
  if (keyword) {
    const like = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(params.get('search') === 'model'
      ? Prisma.sql`t.specification_snapshot ILIKE ${like}`
      : Prisma.sql`(t.code ILIKE ${like} OR t.source_order_no ILIKE ${like} OR t.customer_name_snapshot ILIKE ${like} OR t.product_name_snapshot ILIKE ${like} OR t.specification_snapshot ILIKE ${like} OR EXISTS (SELECT 1 FROM sample_task_assignees a JOIN employees e ON e.id=a.employee_id WHERE a.task_id=t.id AND (e.name ILIKE ${like} OR e.employee_no ILIKE ${like})))`);
  }
  if (params.get('customer')) filters.push(Prisma.sql`t.customer_name_snapshot=${params.get('customer')}`);
  if (params.get('level')) filters.push(Prisma.sql`t.customer_level_code=${params.get('level')}`);
  if (params.get('dataStatus') && params.get('dataStatus') !== 'ALL') filters.push(Prisma.sql`t.data_status=${params.get('dataStatus')}`);
  const member = params.get('assignedToMe') === 'true' ? employeeId : params.get('member');
  if (params.get('assignedToMe') === 'true' && !employeeId) filters.push(Prisma.sql`FALSE`);
  if (member) filters.push(Prisma.sql`EXISTS (SELECT 1 FROM sample_task_assignees a WHERE a.task_id=t.id AND a.employee_id=${member})`);
  const dateFields: Record<string, Prisma.Sql> = { issued: Prisma.sql`t.issued_date`, due: Prisma.sql`t.due_date`, completed: Prisma.sql`(t.completed_at + interval '8 hours')::date` };
  const dateField = dateFields[params.get('dateBy') || 'issued'];
  if (!dateField) throw new SampleQueryError('日期筛选类型无效');
  let from: Date | null, to: Date | null;
  try { from = parseOptionalSampleDate(params.get('from')); to = parseOptionalSampleDate(params.get('to')); } catch { throw new SampleQueryError('筛选日期无效'); }
  if (from && to && from > to) throw new SampleQueryError('开始日期不能晚于结束日期');
  if (from) filters.push(Prisma.sql`${dateField}>=${from}::date`);
  if (to) filters.push(Prisma.sql`${dateField}<=${to}::date`);
  const risk = params.get('risk');
  if (risk === 'MISSING') filters.push(Prisma.sql`${unfinished} AND t.due_date IS NULL`);
  else if (risk === 'WARNING') filters.push(Prisma.sql`(${views.SOON} OR ${views.TODAY} OR ${views.OVERDUE})`);
  const sorts: Record<string, Prisma.Sql> = {
    issued_desc: Prisma.sql`t.issued_date DESC NULLS LAST, t.created_at DESC, t.id`,
    issued_asc: Prisma.sql`t.issued_date ASC NULLS LAST, t.created_at ASC, t.id`,
    due_asc: Prisma.sql`t.due_date ASC NULLS LAST, t.created_at DESC, t.id`,
    completed_desc: Prisma.sql`t.completed_at DESC NULLS LAST, t.created_at DESC, t.id`,
    priority: Prisma.sql`t.priority DESC, t.due_date ASC NULLS LAST, t.created_at DESC, t.id`,
  };
  const order = sorts[params.get('sort') || 'issued_desc'];
  if (!order) throw new SampleQueryError('排序方式无效');
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(params.get(key) || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new SampleQueryError('分页参数无效');
    return value;
  };
  return { base: Prisma.join(filters, ' AND '), views, view, order, page: integer('page', 1, 1000000), pageSize: integer('pageSize', 40, 100) };
}

export async function listSamplePlans(params: URLSearchParams, employeeId?: string | null) {
  const query = samplePlanQuery(params, employeeId);
  return prisma.$transaction(async tx => {
    const countsSql = SAMPLE_VIEWS.map(view => Prisma.sql`COUNT(*) FILTER (WHERE ${query.views[view]})::int AS ${Prisma.raw('"'+view+'"')}`);
    const [counts] = await tx.$queryRaw<Array<Record<SamplePlanView, number>>>(Prisma.sql`SELECT ${Prisma.join(countsSql)} FROM sample_tasks t WHERE ${query.base}`);
    const total = counts[query.view];
    let requestedPage = query.page;
    if (params.get('focusId')) {
      const focused = await tx.$queryRaw<Array<{ position: bigint }>>(Prisma.sql`SELECT position FROM (SELECT t.id, row_number() OVER (ORDER BY ${query.order}) AS position FROM sample_tasks t WHERE ${query.base} AND (${query.views[query.view]})) ranked WHERE id=${params.get('focusId')}`);
      if (focused[0]) requestedPage = Math.ceil(Number(focused[0].position) / query.pageSize);
      else throw new SampleQueryError('指定样品任务已删除或状态已变化，请清除筛选后重新查找');
    }
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / query.pageSize)));
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT t.id FROM sample_tasks t WHERE ${query.base} AND (${query.views[query.view]}) ORDER BY ${query.order} LIMIT ${query.pageSize} OFFSET ${(page-1)*query.pageSize}`);
    const customers = await tx.sampleTask.findMany({ where: { deletedAt: null }, distinct: ['customerNameSnapshot'], select: { customerNameSnapshot: true }, orderBy: { customerNameSnapshot: 'asc' } });
    const compact = params.get('compact') === 'true';
    const tasks = compact
      ? await tx.sampleTask.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: { id: true, specificationSnapshot: true, customerNameSnapshot: true, code: true, status: true, dueDate: true, warningDays: true } })
      : (await tx.sampleTask.findMany({ where: { id: { in: ids.map(row => row.id) } }, include: sampleTaskInclude })).map(serializeSampleTask);
    const byId = new Map(tasks.map(task => [task.id, task]));
    const published = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT (SELECT count(*) FROM sample_data_entries e JOIN sample_tasks t ON t.id=e.task_id WHERE ${query.base} AND t.status<>'CANCELLED' AND e.deleted_at IS NULL AND e.review_status='PUBLISHED')::int + (SELECT count(*) FROM sample_photos p JOIN sample_tasks t ON t.id=p.task_id WHERE ${query.base} AND t.status<>'CANCELLED' AND p.deleted_at IS NULL AND p.review_status='PUBLISHED')::int AS count`);
    return { ok: true, tasks: ids.map(row => byId.get(row.id)), viewCounts: counts, pagination: { page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total/query.pageSize)) }, customers: customers.map(row => row.customerNameSnapshot), summary: { total: counts.ALL-counts.CANCELLED, dueToday: counts.TODAY, overdue: counts.OVERDUE, pendingReview: counts.PENDING_REVIEW, collecting: counts.PLANNED+counts.IN_PROGRESS, completed: counts.COMPLETED, publishedItems: published[0].count } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}
