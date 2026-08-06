ALTER TYPE "work_order_qr_print_mode" ADD VALUE IF NOT EXISTS 'DRAWING_SOP_TRAVELER_SEPARATE';
ALTER TYPE "work_order_qr_print_mode" ADD VALUE IF NOT EXISTS 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX';
ALTER TYPE "work_order_qr_print_mode" ADD VALUE IF NOT EXISTS 'CUSTOM';

CREATE TYPE "work_order_qr_print_material" AS ENUM ('TRAVELER', 'SOP', 'DRAWING');

CREATE TABLE "work_order_qr_print_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "print_id" TEXT NOT NULL,
  "material" "work_order_qr_print_material" NOT NULL,
  "status" "work_order_qr_print_status" NOT NULL DEFAULT 'GENERATED',
  "copies" INTEGER NOT NULL DEFAULT 1,
  "file_id" TEXT,
  "file_version" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "confirmed_by_id" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_qr_print_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_order_qr_print_items_print_id_material_key"
  ON "work_order_qr_print_items"("print_id", "material");
CREATE INDEX "work_order_qr_print_items_print_id_status_idx"
  ON "work_order_qr_print_items"("print_id", "status");
CREATE INDEX "work_order_qr_print_items_material_status_idx"
  ON "work_order_qr_print_items"("material", "status");
CREATE INDEX "work_order_qr_print_items_confirmed_by_id_idx"
  ON "work_order_qr_print_items"("confirmed_by_id");
CREATE INDEX "work_order_qr_print_items_file_id_idx"
  ON "work_order_qr_print_items"("file_id");

ALTER TABLE "work_order_qr_print_items"
  ADD CONSTRAINT "work_order_qr_print_items_print_id_fkey"
  FOREIGN KEY ("print_id") REFERENCES "work_order_qr_prints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_qr_print_items"
  ADD CONSTRAINT "work_order_qr_print_items_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve all historical print evidence as material-level records. Existing
-- traveler-only jobs contain one item; existing SOP jobs contain two items.
INSERT INTO "work_order_qr_print_items" (
  "print_id", "material", "status", "copies", "confirmed_by_id", "confirmed_at"
)
SELECT "id", 'TRAVELER', "status", "copies", "confirmed_by_id", "confirmed_at"
FROM "work_order_qr_prints";

INSERT INTO "work_order_qr_print_items" (
  "print_id", "material", "status", "copies", "file_id", "file_version",
  "file_name", "mime_type", "confirmed_by_id", "confirmed_at"
)
SELECT
  "id", 'SOP', "status", "copies", "sop_file_id", "sop_file_version",
  NULLIF("snapshot"->>'sopFileName', ''),
  NULLIF("snapshot"->>'sopMimeType', ''),
  "confirmed_by_id", "confirmed_at"
FROM "work_order_qr_prints"
WHERE "mode" IN ('TRAVELER_SOP_DUPLEX', 'TRAVELER_SOP_SEPARATE');
