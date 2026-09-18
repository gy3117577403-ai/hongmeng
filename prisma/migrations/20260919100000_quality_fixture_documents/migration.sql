-- AlterTable
ALTER TABLE "PcRequest" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "PcLine" ADD COLUMN     "fixtureBasis" JSONB,
ADD COLUMN     "fixtureId" TEXT,
ADD COLUMN     "fixturePackageId" TEXT;

-- AlterTable
ALTER TABLE "PcFund" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "PcReceipt" ADD COLUMN     "acceptanceNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fixtureDisposition" TEXT NOT NULL DEFAULT 'AVAILABLE';

-- AlterTable
ALTER TABLE "PcStockBalance" ADD COLUMN     "held" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repair" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reserved" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "lineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PcStockMovement" ALTER COLUMN "lineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "QfSettings" (
    "id" TEXT NOT NULL DEFAULT 'quality-fixtures',
    "ownerId" TEXT NOT NULL,
    "supervisorIds" TEXT[],
    "qualityIds" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QfSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfPackage" (
    "continuedWorkOrderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "needFixture" BOOLEAN,
    "parallelCount" INTEGER NOT NULL DEFAULT 1,
    "spareCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "drawingFiles" JSONB NOT NULL,
    "bomFileId" TEXT,
    "bomRows" JSONB NOT NULL,
    "bomMapping" JSONB,
    "bomConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "submittedById" TEXT,
    "submittedByName" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "supervisorId" TEXT,
    "supervisorName" TEXT NOT NULL DEFAULT '',
    "supervisorAt" TIMESTAMP(3),
    "qualityId" TEXT,
    "qualityName" TEXT NOT NULL DEFAULT '',
    "qualityAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QfPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfBomFile" (
    "id" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sheets" JSONB NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QfBomFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfBomTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QfBomTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfConnector" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QfConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfFixture" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '个',
    "itemId" TEXT NOT NULL,
    "assemblyRequired" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QfFixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfMapping" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "preferred" BOOLEAN NOT NULL DEFAULT true,
    "confirmedById" TEXT NOT NULL,
    "confirmedByName" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QfMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfHolding" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL DEFAULT '',
    "person" TEXT NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "issued" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QfHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QfEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QfPlanBinding" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QfPlanBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QfPackage_libraryItemId_status_idx" ON "QfPackage"("libraryItemId", "status");

-- CreateIndex
CREATE INDEX "QfPackage_status_updatedAt_idx" ON "QfPackage"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QfPackage_libraryItemId_sequence_key" ON "QfPackage"("libraryItemId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "QfBomFile_objectKey_key" ON "QfBomFile"("objectKey");

-- CreateIndex
CREATE INDEX "QfBomFile_libraryItemId_deletedAt_idx" ON "QfBomFile"("libraryItemId", "deletedAt");

-- CreateIndex
CREATE INDEX "QfBomFile_libraryItemId_sha256_idx" ON "QfBomFile"("libraryItemId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "QfBomTemplate_name_key" ON "QfBomTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QfConnector_model_manufacturer_key" ON "QfConnector"("model", "manufacturer");

-- CreateIndex
CREATE UNIQUE INDEX "QfFixture_number_key" ON "QfFixture"("number");

-- CreateIndex
CREATE UNIQUE INDEX "QfFixture_itemId_key" ON "QfFixture"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "QfFixture_model_manufacturer_key" ON "QfFixture"("model", "manufacturer");

-- CreateIndex
CREATE INDEX "QfMapping_connectorId_active_idx" ON "QfMapping"("connectorId", "active");

-- CreateIndex
CREATE INDEX "QfMapping_fixtureId_active_idx" ON "QfMapping"("fixtureId", "active");

-- CreateIndex
CREATE INDEX "QfHolding_libraryItemId_idx" ON "QfHolding"("libraryItemId");

-- CreateIndex
CREATE INDEX "QfHolding_workOrderId_idx" ON "QfHolding"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "QfHolding_stockId_libraryItemId_workOrderId_person_key" ON "QfHolding"("stockId", "libraryItemId", "workOrderId", "person");

-- CreateIndex
CREATE INDEX "QfEvent_entityType_entityId_createdAt_idx" ON "QfEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QfPlanBinding_workOrderId_key" ON "QfPlanBinding"("workOrderId");

-- CreateIndex
CREATE INDEX "QfPlanBinding_packageId_idx" ON "QfPlanBinding"("packageId");

-- AddForeignKey
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "QfFixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_fixturePackageId_fkey" FOREIGN KEY ("fixturePackageId") REFERENCES "QfPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfPackage" ADD CONSTRAINT "QfPackage_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfPackage" ADD CONSTRAINT "QfPackage_bomFileId_fkey" FOREIGN KEY ("bomFileId") REFERENCES "QfBomFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfBomFile" ADD CONSTRAINT "QfBomFile_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "drawing_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfFixture" ADD CONSTRAINT "QfFixture_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PcItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfMapping" ADD CONSTRAINT "QfMapping_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "QfConnector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfMapping" ADD CONSTRAINT "QfMapping_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "QfFixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfHolding" ADD CONSTRAINT "QfHolding_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "PcStockBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfPlanBinding" ADD CONSTRAINT "QfPlanBinding_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QfPlanBinding" ADD CONSTRAINT "QfPlanBinding_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "QfPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PcStockBalance" ADD CONSTRAINT "PcStockBalance_fixture_nonnegative"
CHECK ("onHand" >= 0 AND "issued" >= 0 AND "held" >= 0 AND "repair" >= 0 AND "reserved" >= 0 AND "onHand" >= "held" + "repair" + "reserved");
ALTER TABLE "QfHolding" ADD CONSTRAINT "QfHolding_nonnegative" CHECK ("reserved" >= 0 AND "issued" >= 0);
ALTER TABLE "QfPackage" ADD CONSTRAINT "QfPackage_quantity" CHECK ("parallelCount" > 0 AND "spareCount" >= 0);
ALTER TABLE "QfPackage" ADD CONSTRAINT "QfPackage_status" CHECK ("status" IN ('DRAFT','SUPERVISOR','QUALITY','APPROVED','RETURNED','REVOKED','SUPERSEDED'));
ALTER TABLE "PcRequest" ADD CONSTRAINT "PcRequest_source" CHECK ("source" IN ('NORMAL','FIXTURE'));
ALTER TABLE "PcFund" ADD CONSTRAINT "PcFund_source" CHECK ("source" IN ('NORMAL','FIXTURE'));
CREATE UNIQUE INDEX "QfMapping_preferred_active" ON "QfMapping" ("connectorId") WHERE "active" AND "preferred";
