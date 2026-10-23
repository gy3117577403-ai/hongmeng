CREATE TABLE "PcAmountCorrection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lineId" TEXT NOT NULL REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewRole" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "reviewerId" TEXT,
  "reviewerName" TEXT,
  "reviewReason" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "PcAmountCorrection_status_check" CHECK ("status" IN ('PENDING', 'APPLIED', 'REJECTED'))
);
CREATE INDEX "PcAmountCorrection_lineId_createdAt_idx" ON "PcAmountCorrection"("lineId", "createdAt");
CREATE INDEX "PcAmountCorrection_status_reviewRole_idx" ON "PcAmountCorrection"("status", "reviewRole");
CREATE UNIQUE INDEX "PcAmountCorrection_one_pending" ON "PcAmountCorrection"("lineId") WHERE "status" = 'PENDING';
-- A price-only refund records no physical stock movement or returned quantity.
ALTER TABLE "PcReturn" DROP CONSTRAINT "PcReturn_refund_check";
ALTER TABLE "PcReturn" ADD CONSTRAINT "PcReturn_refund_check" CHECK (
  (("kind" = 'AMOUNT_CORRECTION' AND "quantity" = 0 AND "stockId" IS NULL) OR ("kind" <> 'AMOUNT_CORRECTION' AND "quantity" > 0))
  AND "amountCents" > 0 AND "refundDueCents" >= 0
  AND "companyReceivedCents" >= 0 AND "companyReceivedCents" <= "refundedCents" AND "refundedCents" <= "refundDueCents"
);
