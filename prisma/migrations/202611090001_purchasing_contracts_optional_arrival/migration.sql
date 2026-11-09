ALTER TABLE "PcRefund" ADD COLUMN "receiver" TEXT NOT NULL DEFAULT '', ADD COLUMN "account" TEXT NOT NULL DEFAULT '', ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PcContract" ADD COLUMN "document" JSONB, ADD COLUMN "templateRevision" INTEGER, ADD COLUMN "documentStatus" TEXT NOT NULL DEFAULT 'ARCHIVED';
CREATE TABLE "PcContractTemplate" (
  "id" TEXT NOT NULL, "revision" INTEGER NOT NULL, "name" TEXT NOT NULL,
  "content" JSONB NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PcContractTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PcContractTemplate_revision_key" ON "PcContractTemplate"("revision");
ALTER TABLE "material_arrival_batches" ALTER COLUMN "quantity" DROP NOT NULL;
ALTER TABLE "material_arrival_batches" ADD COLUMN "declared_quantity" DOUBLE PRECISION, ADD COLUMN "issue_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "material_arrival_batches" DROP CONSTRAINT "material_arrival_amounts", DROP CONSTRAINT "material_arrival_state";
ALTER TABLE "material_arrival_batches" ADD CONSTRAINT "material_arrival_amounts" CHECK (
  (status='QUANTITY_PENDING' AND quantity IS NULL AND accepted_quantity=0 AND rejected_quantity=0)
  OR (status<>'QUANTITY_PENDING' AND quantity IS NOT NULL AND quantity>0 AND quantity<'Infinity'::float8
    AND accepted_quantity>=0 AND rejected_quantity>=0 AND accepted_quantity+rejected_quantity<=quantity)
);
ALTER TABLE "material_arrival_batches" ADD CONSTRAINT "material_arrival_declared_quantity" CHECK (declared_quantity IS NULL OR (declared_quantity>0 AND declared_quantity<'Infinity'::float8));
ALTER TABLE "material_arrival_batches" ADD CONSTRAINT "material_arrival_state" CHECK (status IN ('SHIPPED','ARRIVED','VERIFIED','CANCELLED','QUANTITY_PENDING'));
