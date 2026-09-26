CREATE TABLE "fg_shipping_reports" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "shipmentId" TEXT,
  "receiptId" TEXT,
  "template" TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "fg_shipping_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fg_shipping_reports_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "fg_shipping_reports_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "fg_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fg_shipping_reports_number_key" ON "fg_shipping_reports"("number");
CREATE UNIQUE INDEX "fg_shipping_reports_requestKey_key" ON "fg_shipping_reports"("requestKey");
CREATE INDEX "fg_shipping_reports_lotId_createdAt_idx" ON "fg_shipping_reports"("lotId", "createdAt");
CREATE INDEX "fg_shipping_reports_shipmentId_idx" ON "fg_shipping_reports"("shipmentId");
