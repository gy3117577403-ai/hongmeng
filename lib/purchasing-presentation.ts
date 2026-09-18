export function purchasingNextStep(p: {
  status: string;
  completedAt: unknown;
  quantity: number;
  receivedQty: number;
  cancelledQty: number;
  payableCents: number;
  paidCents: number;
  refundedCents: number;
  invoiceCents: number;
}) {
  if (p.completedAt) return "采购已完成，收货、资金与票据已核对闭环。";
  if (p.status === "PENDING")
    return "等待采购审批，审批人可逐项通过或填写退回原因。";
  if (p.status === "APPROVED")
    return "待登记采购：请补充供应商、实际采购金额与预计到货日期。";
  if (["DRAFT", "RETURNED", "WITHDRAWN"].includes(p.status))
    return "请补充申请内容，确认后重新提交审批。";
  if (p.status === "VOID") return "该记录已作废，历史操作保留供查阅。";
  const pending = [];
  if (p.receivedQty + p.cancelledQty < p.quantity) pending.push("收货");
  if (p.paidCents - p.refundedCents < p.payableCents) pending.push("资金付款");
  if (p.paidCents - p.refundedCents > p.payableCents) pending.push("退款到账");
  if (p.invoiceCents !== p.payableCents) pending.push("发票核对");
  return pending.length
    ? "待跟进：" +
        pending.join("、") +
        "。付款、收货与票据可按实际情况分别办理。"
    : "请核对退款归还等剩余事项，满足条件后自动完成。";
}
