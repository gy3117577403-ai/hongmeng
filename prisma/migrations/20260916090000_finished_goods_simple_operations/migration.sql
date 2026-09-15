-- Preserve all existing stock, cutover and shipment facts. External document
-- references are optional metadata; formal documents live in another system.
ALTER TABLE "fg_shipments" ADD COLUMN "externalReference" TEXT NOT NULL DEFAULT '';
