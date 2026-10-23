import { pcFundingKey, PurchasingError, type PcRow } from './purchasing-domain';

export const PC_SELECTION_LIMIT = 100;
export function pcSelectPage(selected: string[], pageIds: string[], checked: boolean) {
  const page = new Set(pageIds);
  const next = checked ? [...new Set([...selected, ...pageIds])] : selected.filter(id => !page.has(id));
  if (next.length > PC_SELECTION_LIMIT) throw new PurchasingError(`单次最多选择 ${PC_SELECTION_LIMIT} 项，请缩小筛选范围或分批处理；原选择已保留`);
  return next;
}

export const PC_RECEIPT_STATES = { UNRECEIVED: '未入库', PARTIAL: '部分入库', RECEIVED: '已入库', CANCELLED: '已取消', NOT_ORDERED: '未采购' } as const;
export function pcReceiptState(p: Pick<PcRow, 'status' | 'quantity' | 'receivedQty' | 'cancelledQty' | 'returnedQty'>) {
  const expected = Math.max(0, p.quantity - p.cancelledQty);
  const pending = Math.max(0, expected - p.receivedQty);
  const state = p.status === 'VOID' || expected === 0 ? 'CANCELLED'
    : p.status !== 'ORDERED' ? 'NOT_ORDERED'
    : p.receivedQty <= 0 ? 'UNRECEIVED' : pending > 0 ? 'PARTIAL' : 'RECEIVED';
  return { state, label: PC_RECEIPT_STATES[state], expected, pending: state === 'CANCELLED' ? 0 : pending, returned: p.returnedQty };
}

type FundingLine = {
  id: string; status: string; payableCents: number; reservedCents: number; refundedCents: number;
  settlement: string; payee: string; payeeUserId: string | null; bank: string; account: string;
  supplierId: string | null; currency: string; cycle: string;
  request: { source: string; applicantId: string; submitterId: string };
  returns: { refundDueCents: number; companyReceivedCents: number }[];
  amountCorrections?: { status: string }[];
};
export function pcFundingIssue(p: FundingLine, actorId: string, buyerIds: string[]) {
  if (p.status !== 'ORDERED') return '尚未登记采购';
  if (![...buyerIds, p.request.applicantId, p.request.submitterId, p.payeeUserId].includes(actorId)) return '仅采购经办、申请人或垫付人可申请';
  if (p.amountCorrections?.some(c => c.status === 'PENDING')) return '金额更正正在复核';
  if (p.returns.some(r => r.refundDueCents > r.companyReceivedCents)) return '退款尚未结清';
  if (p.payableCents - p.reservedCents + p.refundedCents <= 0) return '已申请或已结清，无可申请余额';
  return '';
}
export function pcFundingGroups<T extends FundingLine>(lines: T[]) {
  const groups = new Map<string, T[]>();
  for (const p of lines) {
    // Unconfirmed monthly cycles must remain separate, including older records.
    const key = JSON.stringify([p.request.source, pcFundingKey(p), p.settlement === 'MONTHLY' && !p.cycle ? p.id : '']);
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups.values()];
}
