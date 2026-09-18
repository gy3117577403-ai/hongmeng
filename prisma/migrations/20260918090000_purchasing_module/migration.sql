-- CreateTable
CREATE TABLE "PcSettings" (
    "id" TEXT NOT NULL DEFAULT 'purchasing',
    "ownerId" TEXT NOT NULL,
    "purchaseApproverIds" TEXT[],
    "fundApproverIds" TEXT[],
    "financeIds" TEXT[],
    "buyerIds" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcSequence" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PcSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcOperation" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "applicantId" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "submitterName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT,
    "workOrderCode" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PcRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcSupplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payee" TEXT NOT NULL DEFAULT '',
    "bank" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcItem" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "materialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
    "needDate" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "estimateCents" INTEGER NOT NULL,
    "actualCents" INTEGER NOT NULL DEFAULT 0,
    "payableCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "invoiceCents" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "cancelledQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "referenceUrl" TEXT NOT NULL DEFAULT '',
    "supplierId" TEXT,
    "itemId" TEXT,
    "settlement" TEXT NOT NULL DEFAULT 'CORPORATE',
    "payee" TEXT NOT NULL DEFAULT '',
    "payeeUserId" TEXT,
    "bank" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "cycle" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "eta" TEXT NOT NULL DEFAULT '',
    "buyerId" TEXT NOT NULL DEFAULT '',
    "buyerName" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcFund" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "settlement" TEXT NOT NULL,
    "supplierId" TEXT,
    "payee" TEXT NOT NULL,
    "payeeUserId" TEXT,
    "bank" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "cycle" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "originalCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "adjustment" TEXT NOT NULL DEFAULT 'NONE',
    "reason" TEXT NOT NULL DEFAULT '',
    "accountChanged" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcFundAllocation" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PcFundAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcPayment" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcReceipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcStockBalance" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "issued" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PcStockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcStockMovement" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "person" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcReturn" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "stockId" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "refundDueCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "companyReceivedCents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcRefund" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcContract" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supplier" TEXT NOT NULL,
    "purchaser" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "taxNote" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcContractLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "PcContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NORMAL',
    "amountCents" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "PcInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcAttachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'STAGED',
    "entityId" TEXT NOT NULL DEFAULT '',
    "originalName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deleteReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PcAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PcEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PcRequest_number_key" ON "PcRequest"("number");

-- CreateIndex
CREATE INDEX "PcRequest_status_createdAt_idx" ON "PcRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PcRequest_applicantId_createdAt_idx" ON "PcRequest"("applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PcSupplier_name_key" ON "PcSupplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PcItem_number_key" ON "PcItem"("number");

-- CreateIndex
CREATE INDEX "PcItem_name_spec_idx" ON "PcItem"("name", "spec");

-- CreateIndex
CREATE UNIQUE INDEX "PcLine_number_key" ON "PcLine"("number");

-- CreateIndex
CREATE INDEX "PcLine_status_createdAt_idx" ON "PcLine"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PcLine_supplierId_settlement_idx" ON "PcLine"("supplierId", "settlement");

-- CreateIndex
CREATE INDEX "PcLine_requestId_idx" ON "PcLine"("requestId");

-- CreateIndex
CREATE INDEX "PcLine_completedAt_idx" ON "PcLine"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PcFund_number_key" ON "PcFund"("number");

-- CreateIndex
CREATE INDEX "PcFund_status_createdAt_idx" ON "PcFund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PcFund_payeeUserId_idx" ON "PcFund"("payeeUserId");

-- CreateIndex
CREATE INDEX "PcFundAllocation_lineId_active_idx" ON "PcFundAllocation"("lineId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PcFundAllocation_fundId_lineId_key" ON "PcFundAllocation"("fundId", "lineId");

-- CreateIndex
CREATE INDEX "PcPayment_fundId_idx" ON "PcPayment"("fundId");

-- CreateIndex
CREATE INDEX "PcReceipt_lineId_idx" ON "PcReceipt"("lineId");

-- CreateIndex
CREATE INDEX "PcReceipt_number_idx" ON "PcReceipt"("number");

-- CreateIndex
CREATE INDEX "PcStockBalance_itemId_idx" ON "PcStockBalance"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PcStockBalance_lineId_warehouse_location_key" ON "PcStockBalance"("lineId", "warehouse", "location");

-- CreateIndex
CREATE INDEX "PcStockMovement_stockId_createdAt_idx" ON "PcStockMovement"("stockId", "createdAt");

-- CreateIndex
CREATE INDEX "PcStockMovement_lineId_createdAt_idx" ON "PcStockMovement"("lineId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PcReturn_number_key" ON "PcReturn"("number");

-- CreateIndex
CREATE INDEX "PcReturn_lineId_idx" ON "PcReturn"("lineId");

-- CreateIndex
CREATE INDEX "PcRefund_returnId_idx" ON "PcRefund"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "PcContract_number_revision_key" ON "PcContract"("number", "revision");

-- CreateIndex
CREATE INDEX "PcContractLine_lineId_idx" ON "PcContractLine"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PcContractLine_contractId_lineId_key" ON "PcContractLine"("contractId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PcInvoice_number_key" ON "PcInvoice"("number");

-- CreateIndex
CREATE INDEX "PcInvoiceLine_lineId_idx" ON "PcInvoiceLine"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PcInvoiceLine_invoiceId_lineId_key" ON "PcInvoiceLine"("invoiceId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PcAttachment_objectKey_key" ON "PcAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "PcAttachment_entityType_entityId_deletedAt_idx" ON "PcAttachment"("entityType", "entityId", "deletedAt");

-- CreateIndex
CREATE INDEX "PcEvent_entityType_entityId_createdAt_idx" ON "PcEvent"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PcRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "PcSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PcItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcFundAllocation" ADD CONSTRAINT "PcFundAllocation_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PcFund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcFundAllocation" ADD CONSTRAINT "PcFundAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcPayment" ADD CONSTRAINT "PcPayment_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PcFund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcReceipt" ADD CONSTRAINT "PcReceipt_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcStockBalance" ADD CONSTRAINT "PcStockBalance_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcStockBalance" ADD CONSTRAINT "PcStockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PcItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcStockMovement" ADD CONSTRAINT "PcStockMovement_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "PcStockBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcStockMovement" ADD CONSTRAINT "PcStockMovement_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcReturn" ADD CONSTRAINT "PcReturn_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcRefund" ADD CONSTRAINT "PcRefund_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PcReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcContractLine" ADD CONSTRAINT "PcContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PcContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcContractLine" ADD CONSTRAINT "PcContractLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcInvoiceLine" ADD CONSTRAINT "PcInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PcInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcInvoiceLine" ADD CONSTRAINT "PcInvoiceLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PcLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
