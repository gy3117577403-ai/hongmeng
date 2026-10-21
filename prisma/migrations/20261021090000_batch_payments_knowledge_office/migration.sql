ALTER TABLE "knowledge_attachments" ALTER COLUMN "article_id" DROP NOT NULL;

CREATE TABLE "PcPaymentBatch" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "totalCents" BIGINT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PcPaymentBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PcPaymentBatch_positive_total" CHECK ("totalCents" > 0)
);
CREATE UNIQUE INDEX "PcPaymentBatch_number_key" ON "PcPaymentBatch"("number");
ALTER TABLE "PcPayment" ADD COLUMN "batchId" TEXT;
CREATE INDEX "PcPayment_batchId_idx" ON "PcPayment"("batchId");
ALTER TABLE "PcPayment" ADD CONSTRAINT "PcPayment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PcPaymentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
