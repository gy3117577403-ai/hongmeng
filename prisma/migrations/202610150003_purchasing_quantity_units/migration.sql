-- Freeze the original measurement unit before enabling audited unit corrections.
ALTER TABLE "PcReceipt" ADD COLUMN "unit" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PcStockMovement" ADD COLUMN "unit" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PcReturn" ADD COLUMN "unit" TEXT NOT NULL DEFAULT '';
UPDATE "PcReceipt" r SET "unit" = l."unit" FROM "PcLine" l WHERE r."lineId" = l."id";
UPDATE "PcReturn" r SET "unit" = l."unit" FROM "PcLine" l WHERE r."lineId" = l."id";
UPDATE "PcStockMovement" m SET "unit" = i."unit"
  FROM "PcStockBalance" b JOIN "PcItem" i ON i."id" = b."itemId"
  WHERE m."stockId" = b."id";

-- An unfinished draft may omit quantity; submitted lines still require a positive quantity.
ALTER TABLE "PcLine" DROP CONSTRAINT "PcLine_quantity_facts_check";
ALTER TABLE "PcLine" ADD CONSTRAINT "PcLine_quantity_facts_check" CHECK (
  ("quantity" > 0 OR ("quantity" = 0 AND "status" IN ('DRAFT', 'WITHDRAWN', 'RETURNED', 'VOID')))
  AND "receivedQty" >= 0 AND "returnedQty" >= 0 AND "cancelledQty" >= 0
  AND "returnedQty" <= "receivedQty" AND "receivedQty" + "cancelledQty" <= "quantity"
);
