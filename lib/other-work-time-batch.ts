import { prisma } from '@/lib/prisma';
import type { OtherWorkActor } from '@/lib/other-work-time-access';
import { canReadOtherWork, canReviewOtherWork, commandOtherWork, otherWorkListWhere, OtherWorkError } from '@/lib/other-work-time-service';
import { dateKeyFromDatabase } from '@/lib/attendance';

export type OtherWorkBatchItem = { id: string; version: number };
export type OtherWorkBatchResult = { id: string; outcome: 'approved' | 'skipped' | 'failed'; message: string; replayed?: boolean };
export const OTHER_WORK_BATCH_LIMIT = 30;
export const OTHER_WORK_SELECTION_LIMIT = 1000;

export async function selectOtherWorkBatch(actor: OtherWorkActor, query: URLSearchParams) {
  if (query.get('scope') !== 'manage') throw new OtherWorkError('请在管理台账选择待审批记录', 403);
  const scoped = new URLSearchParams(query); scoped.set('status', 'PENDING');
  const rows = await prisma.otherWorkTimeRequest.findMany({ where: otherWorkListWhere(actor, scoped),
    orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: OTHER_WORK_SELECTION_LIMIT + 1,
    select: { id: true, version: true, employeeId: true, createdById: true, teamIdSnapshot: true, teamSnapshot: true,
      employeeNameSnapshot: true, employeeNoSnapshot: true, workDate: true, requestedMinutes: true, categoryNameSnapshot: true } });
  if (rows.length > OTHER_WORK_SELECTION_LIMIT) throw new OtherWorkError('筛选范围超过 1000 笔，请缩小日期或员工范围后选择');
  const eligible = rows.filter(row => canReviewOtherWork(actor, row));
  return { rows: eligible.map(({ createdById: _creator, teamIdSnapshot: _team, ...row }) => ({ ...row, workDate: dateKeyFromDatabase(row.workDate) })),
    skipped: rows.length - eligible.length };
}

export function parseOtherWorkBatch(data: Record<string, unknown>) {
  const batchId = typeof data.batchId === 'string' ? data.batchId : '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(batchId)) throw new OtherWorkError('批次标识无效，请重新选择');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > OTHER_WORK_BATCH_LIMIT) throw new OtherWorkError('每批须包含 1 至 30 笔记录');
  const ids = new Set<string>();
  const items = data.items.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new OtherWorkError('审批记录无效');
    const { id, version } = raw as OtherWorkBatchItem;
    if (typeof id !== 'string' || !id || id.length > 100 || !Number.isInteger(version) || version < 0 || ids.has(id)) throw new OtherWorkError('审批记录或版本无效，不能重复提交同一记录');
    ids.add(id); return { id, version };
  });
  return { batchId, items };
}

export async function approveOtherWorkBatch(actor: OtherWorkActor, data: Record<string, unknown>) {
  const { batchId, items } = parseOtherWorkBatch(data);
  const results: OtherWorkBatchResult[] = [];
  // Small sequential groups bound database load. Each item uses the existing
  // employee lock and atomic approval/audit/notification transaction.
  for (const item of items) {
    try {
      const row = await prisma.otherWorkTimeRequest.findUnique({ where: { id: item.id } });
      if (!row || !canReadOtherWork(actor, row)) throw new OtherWorkError('申报不存在或没有查看权限', 404);
      if (!canReviewOtherWork(actor, row)) throw new OtherWorkError('不能自审或审批授权范围外的申请', 403);
      const receipt = () => prisma.otherWorkTimeReview.findFirst({ where: { requestId: item.id, actorId: actor.id,
        action: 'APPROVE', requestVersion: item.version, detail: { path: ['batchId'], equals: batchId } }, select: { id: true } });
      if (await receipt()) { results.push({ id: item.id, outcome: 'approved', replayed: true, message: '本批次此前已通过' }); continue; }
      try {
        await commandOtherWork(actor, item.id, { action: 'APPROVE', version: item.version }, batchId);
      } catch (error) {
        // A simultaneous replay may have committed while this request waited
        // on the employee lock. Never mistake it for a second approval.
        if (!(await receipt())) throw error;
        results.push({ id: item.id, outcome: 'approved', replayed: true, message: '本批次此前已通过' }); continue;
      }
      results.push({ id: item.id, outcome: 'approved', message: '已按原申报时长通过' });
    } catch (error) {
      results.push({ id: item.id, outcome: error instanceof OtherWorkError && [403, 404, 409].includes(error.status) ? 'skipped' : 'failed',
        message: error instanceof OtherWorkError ? error.message : '处理失败，请重试；已完成记录不会重复审批' });
    }
  }
  return { batchId, results };
}
