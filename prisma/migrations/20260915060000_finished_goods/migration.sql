-- CreateTable
CREATE TABLE "fg_lots" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "movementId" TEXT,
    "workOrderId" TEXT,
    "workOrderCode" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "specification" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '件',
    "ownerType" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "customerName" TEXT NOT NULL DEFAULT '',
    "sourceQuantity" INTEGER NOT NULL,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT NOT NULL DEFAULT '',
    "openingReview" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fg_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_ledger" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_holds" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "released" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "dueDate" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_shipments" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "customerName" TEXT NOT NULL,
    "recipient" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'COURIER',
    "carrier" TEXT NOT NULL DEFAULT '',
    "waybills" JSONB NOT NULL DEFAULT '[]',
    "boxes" INTEGER NOT NULL DEFAULT 1,
    "handoverName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT,
    "plannedDate" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fg_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_shipment_lines" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "dailyItemId" TEXT,

    CONSTRAINT "fg_shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_dispatch_batches" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "carrier" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMP(3),
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_dispatch_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_returns" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_reworks" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "scrapped" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_reworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_attachments" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fg_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_mutations" (
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_mutations_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "fg_sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fg_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "fg_lots_sourceKey_key" ON "fg_lots"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "fg_lots_movementId_key" ON "fg_lots"("movementId");

-- CreateIndex
CREATE INDEX "fg_lots_workOrderId_idx" ON "fg_lots"("workOrderId");

-- CreateIndex
CREATE INDEX "fg_lots_customerName_productKey_idx" ON "fg_lots"("customerName", "productKey");

-- CreateIndex
CREATE INDEX "fg_lots_createdAt_idx" ON "fg_lots"("createdAt");

-- CreateIndex
CREATE INDEX "fg_ledger_lotId_createdAt_idx" ON "fg_ledger"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "fg_ledger_createdAt_kind_idx" ON "fg_ledger"("createdAt", "kind");

-- CreateIndex
CREATE INDEX "fg_holds_dueDate_idx" ON "fg_holds"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fg_shipments_number_key" ON "fg_shipments"("number");

-- CreateIndex
CREATE INDEX "fg_shipments_status_plannedDate_idx" ON "fg_shipments"("status", "plannedDate");

-- CreateIndex
CREATE INDEX "fg_shipments_shippedAt_idx" ON "fg_shipments"("shippedAt");

-- CreateIndex
CREATE INDEX "fg_shipment_lines_lotId_idx" ON "fg_shipment_lines"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "fg_shipment_lines_shipmentId_lotId_key" ON "fg_shipment_lines"("shipmentId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "fg_dispatch_batches_number_key" ON "fg_dispatch_batches"("number");

-- CreateIndex
CREATE UNIQUE INDEX "fg_dispatch_batches_businessDate_sequence_key" ON "fg_dispatch_batches"("businessDate", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "fg_returns_lotId_key" ON "fg_returns"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "fg_attachments_objectKey_key" ON "fg_attachments"("objectKey");

-- CreateIndex
CREATE INDEX "fg_attachments_shipmentId_deletedAt_idx" ON "fg_attachments"("shipmentId", "deletedAt");

-- AddForeignKey
ALTER TABLE "fg_ledger" ADD CONSTRAINT "fg_ledger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "fg_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_holds" ADD CONSTRAINT "fg_holds_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "fg_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_shipments" ADD CONSTRAINT "fg_shipments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "fg_dispatch_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_shipment_lines" ADD CONSTRAINT "fg_shipment_lines_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fg_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_shipment_lines" ADD CONSTRAINT "fg_shipment_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "fg_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_returns" ADD CONSTRAINT "fg_returns_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "fg_shipment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_reworks" ADD CONSTRAINT "fg_reworks_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "fg_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_attachments" ADD CONSTRAINT "fg_attachments_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fg_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
