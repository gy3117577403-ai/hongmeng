import { PurchasingError } from './purchasing-domain';

type ReimbursementLine = {
  id: string; name: string; settlement: string; payeeUserId: string | null;
  currency: string; request: { source: string };
  allocations?: { active: boolean; fund: { settlement: string; status: string; payeeUserId: string | null; paidCents: number } }[];
};

/** Account snapshots may differ; the person who advanced the money may not. */
export function pcReimbursementScope(lines: ReimbursementLine[]) {
  if (!lines.length) throw new PurchasingError('请保留至少一项个人垫付采购');
  const other = lines.filter(line => line.settlement !== 'ADVANCE');
  if (other.length) throw new PurchasingError(`以下项目不是个人垫付，请移除后报销：${other.map(l => l.name).join('、')}`);
  if (new Set(lines.map(line => line.request.source)).size !== 1) throw new PurchasingError('普通采购与治具采购须分别申请报销');
  if (new Set(lines.map(line => line.currency)).size !== 1) throw new PurchasingError('不同币种须分别申请报销');
  const payeeIds = [...new Set(lines.flatMap(line => [line.payeeUserId,
    ...(line.allocations || []).filter(a => (a.active || a.fund.paidCents > 0) && a.fund.settlement === 'ADVANCE' && !['RETURNED', 'WITHDRAWN'].includes(a.fund.status)).map(a => a.fund.payeeUserId),
  ]).filter((id): id is string => !!id))];
  if (payeeIds.length > 1) throw new PurchasingError('选中记录属于不同实际垫付人，请只保留同一垫付人的采购后申请报销');
  return { payeeUserId: payeeIds[0] || '', legacyIds: lines.filter(line => !line.payeeUserId).map(line => line.id) };
}
