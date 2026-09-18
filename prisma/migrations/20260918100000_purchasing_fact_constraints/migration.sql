-- Money and inventory facts cannot become negative, even on future write paths.
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_quantity_facts_check" CHECK (
  "quantity" > 0 AND "receivedQty" >= 0 AND "returnedQty" >= 0 AND "cancelledQty" >= 0
  AND "returnedQty" <= "receivedQty" AND "receivedQty" + "cancelledQty" <= "quantity"
);
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_money_facts_check" CHECK (
  "estimateCents" >= 0 AND "actualCents" >= 0 AND "payableCents" >= 0
  AND "reservedCents" >= 0 AND "paidCents" >= 0 AND "refundedCents" >= 0 AND "invoiceCents" >= 0
  AND "refundedCents" <= "paidCents"
);
ALTER TABLE "PcStockBalance" ADD CONSTRAINT "PcStockBalance_quantity_check" CHECK ("onHand" >= 0 AND "issued" >= 0);
ALTER TABLE "PcFund" ADD CONSTRAINT "PcFund_payment_check" CHECK ("amountCents" >= 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "PcFundAllocation" ADD CONSTRAINT "PcFundAllocation_payment_check" CHECK ("amountCents" >= 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "PcReturn" ADD CONSTRAINT "PcReturn_refund_check" CHECK (
  "quantity" > 0 AND "amountCents" > 0 AND "refundDueCents" >= 0
  AND "companyReceivedCents" >= 0 AND "companyReceivedCents" <= "refundedCents" AND "refundedCents" <= "refundDueCents"
);
ALTER TABLE "PcReceipt" ADD CONSTRAINT "PcReceipt_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "PcPayment" ADD CONSTRAINT "PcPayment_positive_check" CHECK ("amountCents" > 0);
ALTER TABLE "PcRefund" ADD CONSTRAINT "PcRefund_positive_check" CHECK ("amountCents" > 0);
